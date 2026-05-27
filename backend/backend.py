"""
Query Genie – FastAPI Backend
Fixed version: all known bugs resolved, code quality improved.
"""

import ast
import hashlib
import json
import logging
import os
import random
import re
import smtplib
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import lru_cache
from typing import Any, Dict, List, Literal, Optional, Tuple
from urllib.parse import quote_plus

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from langchain_community.utilities import SQLDatabase
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_groq import ChatGroq
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, create_engine, inspect, text, pool
from sqlalchemy.exc import OperationalError, ProgrammingError, SQLAlchemyError
from sqlalchemy.orm import Session, declarative_base, sessionmaker

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
load_dotenv()

GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
EMAIL_HOST_USER: str = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD: str = os.getenv("EMAIL_HOST_PASSWORD", "")


def validate_environment() -> None:
    """Raise on missing critical env vars; warn on optional ones."""
    if not GROQ_API_KEY:
        raise RuntimeError("Missing critical env var: GROQ_API_KEY")
    if not EMAIL_HOST_USER or not EMAIL_HOST_PASSWORD:
        logger.warning("Email credentials missing – OTP emails disabled")
    logger.info("Environment variables validated")


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


# ---------------------------------------------------------------------------
# Timezone helper
# ---------------------------------------------------------------------------
def make_tz_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Attach UTC tzinfo to a naive datetime (SQLite compat)."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------------------
# Database-type constants & helpers
# ---------------------------------------------------------------------------
class DatabaseType:
    MYSQL = "mysql"
    POSTGRESQL = "postgresql"

    @staticmethod
    def get_driver(db_type: str) -> str:
        return "postgresql" if db_type == DatabaseType.POSTGRESQL else "mysql+mysqlconnector"


def build_db_uri(host: str, port: int, user: str, password: str, db_type: str, database: str = "") -> str:
    """Build a SQLAlchemy connection URI."""
    encoded_pw = quote_plus(password) if password else ""
    if db_type == DatabaseType.POSTGRESQL:
        db_part = database if database else "postgres"
        return f"postgresql://{user}:{encoded_pw}@{host}:{port}/{db_part}"
    db_part = f"/{database}" if database else ""
    return f"mysql+mysqlconnector://{user}:{encoded_pw}@{host}:{port}{db_part}"


def get_list_databases_query(db_type: str) -> Tuple[str, List[str]]:
    """Return (SQL, system_db_names_to_exclude)."""
    if db_type == DatabaseType.POSTGRESQL:
        return (
            "SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres'",
            ["postgres", "template0", "template1"],
        )
    return (
        "SHOW DATABASES",
        ["information_schema", "mysql", "performance_schema", "sys"],
    )


def get_create_database_sql(db_type: str, name: str) -> str:
    if db_type == DatabaseType.POSTGRESQL:
        return f'CREATE DATABASE "{name}"'
    return f"CREATE DATABASE `{name}`"


# ---------------------------------------------------------------------------
# Connection-pool manager
# ---------------------------------------------------------------------------
class DatabaseConnectionPool:
    """Thread-safe pool of SQLAlchemy engines and LangChain SQLDatabase objects."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._engines: Dict[str, Any] = {}
        self._sql_dbs: Dict[str, SQLDatabase] = {}
        self._db_types: Dict[str, str] = {}

    def get_engine(self, uri: str, db_type: str = "") -> Any:
        with self._lock:
            if uri not in self._engines:
                logger.info("Creating connection pool for %s", db_type or "unknown")
                self._engines[uri] = create_engine(
                    uri,
                    poolclass=pool.QueuePool,
                    pool_size=10,
                    max_overflow=20,
                    pool_timeout=30,
                    pool_recycle=3600,
                    pool_pre_ping=True,
                    echo=False,
                )
                if db_type:
                    self._db_types[uri] = db_type
            return self._engines[uri]

    def get_sql_db(self, uri: str, db_type: str = "") -> SQLDatabase:
        with self._lock:
            if uri not in self._sql_dbs:
                engine = self.get_engine(uri, db_type)
                self._sql_dbs[uri] = SQLDatabase(engine)
            return self._sql_dbs[uri]

    def get_db_type(self, uri: str) -> str:
        return self._db_types.get(uri, "")

    def clear(self, uri: str) -> None:
        with self._lock:
            if uri in self._engines:
                self._engines[uri].dispose()
                del self._engines[uri]
            self._sql_dbs.pop(uri, None)
            self._db_types.pop(uri, None)

    def clear_all(self) -> None:
        for uri in list(self._engines.keys()):
            self.clear(uri)


db_pool = DatabaseConnectionPool()


# ---------------------------------------------------------------------------
# Schema cache (TTL-based)
# ---------------------------------------------------------------------------
class SchemaCache:
    def __init__(self, ttl_minutes: int = 30) -> None:
        self._lock = threading.Lock()
        self._cache: Dict[str, str] = {}
        self._timestamps: Dict[str, datetime] = {}
        self._ttl = timedelta(minutes=ttl_minutes)

    def get(self, uri: str, sql_db: SQLDatabase) -> str:
        with self._lock:
            now = datetime.now(timezone.utc)
            ts = self._timestamps.get(uri)
            if ts and (now - ts) < self._ttl:
                logger.debug("Schema cache hit")
                return self._cache[uri]
            logger.info("Fetching fresh schema for %s", uri)
            schema = sql_db.get_table_info()
            self._cache[uri] = schema
            self._timestamps[uri] = now
            return schema

    def invalidate(self, uri: str) -> None:
        with self._lock:
            self._cache.pop(uri, None)
            self._timestamps.pop(uri, None)

    def clear_all(self) -> None:
        with self._lock:
            self._cache.clear()
            self._timestamps.clear()


schema_cache = SchemaCache()


# ---------------------------------------------------------------------------
# Query result cache (LRU-style)
# ---------------------------------------------------------------------------
class QueryCache:
    def __init__(self, max_size: int = 100) -> None:
        self._lock = threading.Lock()
        # Stores strings (the final_result text)
        self._cache: Dict[str, str] = {}
        self._max_size = max_size

    def _make_key(self, question: str, uri: str, history: List) -> Optional[str]:
        if len(history) > 4:
            return None
        history_str = json.dumps([m.content for m in history[-4:]])
        raw = f"{question}|{uri}|{history_str}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, question: str, uri: str, history: List) -> Optional[str]:
        key = self._make_key(question, uri, history)
        if not key:
            return None
        with self._lock:
            return self._cache.get(key)

    def set(self, question: str, uri: str, history: List, result: str) -> None:
        key = self._make_key(question, uri, history)
        if not key:
            return
        with self._lock:
            if len(self._cache) >= self._max_size:
                # Evict oldest entry
                oldest = next(iter(self._cache))
                del self._cache[oldest]
            self._cache[key] = result

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


query_cache = QueryCache(max_size=100)


# ---------------------------------------------------------------------------
# SQLite (users) DB setup
# ---------------------------------------------------------------------------
SQLITE_DB_FILE = "users.db"

engine = create_engine(
    f"sqlite:///{SQLITE_DB_FILE}",
    echo=False,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False},
)
Base = declarative_base()


# ---------------------------------------------------------------------------
# ORM Models
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    phone = Column(String, unique=True, index=True, nullable=True)
    firstName = Column(String, nullable=False)
    lastName = Column(String, nullable=False)
    gender = Column(String, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    messages = Column(Text, nullable=False)
    is_starred = Column(Integer, default=0)


class OTP(Base):
    __tablename__ = "otps"
    email = Column(String, primary_key=True, index=True)
    otp = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ProfileUpdateOTP(Base):
    __tablename__ = "profile_update_otps"
    user_id = Column(Integer, primary_key=True, index=True)
    otp = Column(String, nullable=False)
    new_email = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class PasswordResetOTP(Base):
    __tablename__ = "password_reset_otps"
    email = Column(String, primary_key=True, index=True)
    otp = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(engine)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------
class DBCredentials(BaseModel):
    host: str
    port: int
    user: str
    password: str = ""
    db_type: Literal["mysql", "postgresql"]


class DBSelection(BaseModel):
    host: str
    port: int
    user: str
    password: str = ""
    database: str
    db_type: Literal["mysql", "postgresql"]


class DBCreate(BaseModel):
    host: str
    port: int
    user: str
    password: str = ""
    database_name: str
    db_type: Literal["mysql", "postgresql"]

    @field_validator("database_name")
    @classmethod
    def validate_db_name(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_]{1,63}$", v):
            raise ValueError("Database name must be 1–63 alphanumeric/underscore characters")
        return v


class ChatRequest(BaseModel):
    question: str
    chat_history: List[Dict[str, str]]


class UserCreate(BaseModel):
    firstName: str
    lastName: str
    email: EmailStr
    phone: Optional[str] = None
    password: str
    otp: str
    gender: str
    username: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserLogin(BaseModel):
    identifier: str
    password: str


class OtpRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


# BUG FIX: was accepting raw dict – now a proper Pydantic model
class VerifyResetOTPRequest(BaseModel):
    email: EmailStr
    otp: str


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class ConfirmSQLRequest(BaseModel):
    user_id: int
    confirm: bool
    sql: str


class UpdateProfileRequest(BaseModel):
    userId: int
    firstName: str
    lastName: str
    username: str
    email: EmailStr
    phone: Optional[str] = None
    gender: str


class ChangePasswordRequest(BaseModel):
    userId: int
    currentPassword: str
    newPassword: str

    @field_validator("newPassword")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("New password must be at least 8 characters")
        return v


class SendEmailOTPRequest(BaseModel):
    userId: int
    newEmail: EmailStr


class UpdateEmailRequest(BaseModel):
    userId: int
    newEmail: EmailStr
    otp: str


class StarSessionRequest(BaseModel):
    user_id: int
    is_starred: bool


class RenameSessionRequest(BaseModel):
    user_id: int
    title: str


class CreateSessionRequest(BaseModel):
    user_id: int
    title: str = "Untitled Chat"
    messages: List[Any] = []
    isStarred: bool = False


# ---------------------------------------------------------------------------
# Email helpers
# ---------------------------------------------------------------------------
def _send_email(to: str, subject: str, html_body: str) -> bool:
    """Internal helper – sends one HTML email. Returns True on success."""
    if not EMAIL_HOST_USER or not EMAIL_HOST_PASSWORD:
        logger.warning("Email credentials not set; skipping send to %s", to)
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = EMAIL_HOST_USER
    msg["To"] = to
    msg.attach(MIMEText(html_body, "html"))
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as srv:
            srv.login(EMAIL_HOST_USER, EMAIL_HOST_PASSWORD)
            srv.sendmail(EMAIL_HOST_USER, to, msg.as_string())
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to, exc)
        return False


def send_otp_email(to: str, otp: str) -> bool:
    html = f"""
    <html><body>
      <div style="font-family:Arial,sans-serif;text-align:center;color:#333">
        <h2>Welcome to Query Genie!</h2>
        <p>Your one-time verification code is:</p>
        <p style="font-size:24px;font-weight:bold;letter-spacing:2px;color:#007BFF">{otp}</p>
        <p>Expires in 5 minutes.</p>
      </div>
    </body></html>"""
    return _send_email(to, "Your Verification Code", html)


def send_password_reset_email(to: str, otp: str) -> bool:
    html = f"""
    <html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">
      <div style="max-width:500px;margin:auto;background:#fff;border-radius:8px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;text-align:center">
          <h1 style="color:#fff;margin:0">Password Reset</h1>
        </div>
        <div style="padding:30px;text-align:center">
          <p>Your reset code:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#667eea">{otp}</p>
          <p style="font-size:13px;color:#666">Expires in <strong>10 minutes</strong>.</p>
        </div>
      </div>
    </body></html>"""
    return _send_email(to, "Password Reset Code – Query Genie", html)


def send_email_change_otp(to: str, otp: str, user_name: str) -> bool:
    html = f"""
    <html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">
      <div style="max-width:500px;margin:auto;background:#fff;border-radius:8px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;text-align:center">
          <h1 style="color:#fff;margin:0">Verify New Email</h1>
        </div>
        <div style="padding:30px">
          <p>Hi <strong>{user_name}</strong>,</p>
          <p>Use this code to verify your new email address:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#667eea;text-align:center">{otp}</p>
          <p style="font-size:13px;color:#666">Expires in <strong>5 minutes</strong>.</p>
        </div>
      </div>
    </body></html>"""
    return _send_email(to, "Verify Your New Email – Query Genie", html)


# ---------------------------------------------------------------------------
# OTP utility
# ---------------------------------------------------------------------------
def generate_otp() -> str:
    return str(random.randint(100000, 999999))


# ---------------------------------------------------------------------------
# SQL safety
# ---------------------------------------------------------------------------
_DANGEROUS_KEYWORDS = {"DROP", "TRUNCATE", "DELETE", "ALTER", "UPDATE"}
_INJECTION_PATTERNS = [
    r";\s*DROP",
    r"--",
    r"/\*.*?\*/",
    r"UNION\s+SELECT",
    r"OR\s+1\s*=\s*1",
    r"AND\s+1\s*=\s*1",
    r"'\s*OR\s*'",
    r";\s*EXEC",
    r"xp_cmdshell",
]


def detect_dangerous_sql(sql: str) -> List[str]:
    upper = sql.upper()
    dangers: List[str] = [kw for kw in _DANGEROUS_KEYWORDS if kw in upper]
    for pat in _INJECTION_PATTERNS:
        if re.search(pat, sql, re.IGNORECASE | re.DOTALL):
            dangers.append(f"INJECTION_PATTERN:{pat}")
    return dangers


def sanitize_sql(sql: str) -> str:
    sql = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return sql.strip()


def sql_to_table_preview(sql: str) -> Dict:
    upper = sql.upper()
    action, table, condition = "UNKNOWN", "-", "-"
    if upper.startswith("DELETE"):
        action = "DELETE"
        m = re.search(r"FROM\s+[`\"]?(\w+)[`\"]?", upper)
        if m:
            table = m.group(1)
    elif upper.startswith("UPDATE"):
        action = "UPDATE"
        m = re.search(r"UPDATE\s+[`\"]?(\w+)[`\"]?", upper)
        if m:
            table = m.group(1)
    elif upper.startswith("DROP"):
        action = "DROP"
        m = re.search(r"DROP\s+TABLE\s+[`\"]?(\w+)[`\"]?", upper)
        if m:
            table = m.group(1)
    w = re.search(r"WHERE\s+(.+)", sql, re.IGNORECASE)
    if w:
        condition = w.group(1)
    return {
        "columns": ["Action", "Table", "Condition", "Impact"],
        "data": [[action, table, condition, "Removes/modifies record(s) permanently"]],
    }


# ---------------------------------------------------------------------------
# Column detection (NOTE: invalidation is tied to schema_cache.invalidate)
# ---------------------------------------------------------------------------
def get_columns_from_query(uri: str, sql: str) -> List[str]:
    """Execute a query and return its column names."""
    try:
        eng = db_pool.get_engine(uri)
        with eng.connect() as conn:
            result = conn.execute(text(sql))
            return list(result.keys())
    except Exception as exc:
        logger.warning("Could not get columns for query: %s", exc)
        return []


def extract_table_name(sql: str) -> Optional[str]:
    for pat in [
        r"FROM\s+[`\"]?(\w+)[`\"]?",
        r"JOIN\s+[`\"]?(\w+)[`\"]?",
        r"INTO\s+[`\"]?(\w+)[`\"]?",
        r"UPDATE\s+[`\"]?(\w+)[`\"]?",
    ]:
        m = re.search(pat, sql, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


# ---------------------------------------------------------------------------
# PostgreSQL result string parser
# ---------------------------------------------------------------------------
def parse_pg_result(raw: str) -> List:
    """
    Safely parse a LangChain/SQLAlchemy result string such as
    "[('val',), ('val2',)]" or "[(1, 'text'), (2, 'text')]".
    Falls back gracefully.
    """
    raw = raw.strip()
    if not raw or raw == "[]":
        return []
    try:
        parsed = ast.literal_eval(raw)
        if isinstance(parsed, list):
            return parsed
    except (ValueError, SyntaxError) as exc:
        logger.debug("ast.literal_eval failed (%s); trying regex fallback", exc)

    rows = []
    for row_str in re.findall(r"\([^)]*\)", raw):
        inner = row_str.strip("()")
        values: List = []
        for part in inner.split(","):
            part = part.strip().strip("'\"")
            # Only convert to int/float when the entire value is numeric
            try:
                values.append(int(part))
            except ValueError:
                try:
                    values.append(float(part))
                except ValueError:
                    values.append(part)
        rows.append(tuple(values) if len(values) != 1 else (values[0],))
    return rows


# ---------------------------------------------------------------------------
# LangChain SQL chain
# ---------------------------------------------------------------------------
def build_sql_chain(schema: str, db_type: str):
    if db_type == DatabaseType.POSTGRESQL:
        template = """You are a PostgreSQL expert. Return ONLY the SQL query – no markdown, no explanation.

Rules:
- Use double-quoted identifiers ("table_name")
- End with a semicolon

Schema: {schema}
History: {chat_history}
Question: {question}

SQL:"""
    else:
        template = """You are a MySQL expert. Return ONLY the SQL query – no markdown, no explanation.

Rules:
- Use backtick identifiers (`table_name`)
- End with a semicolon

Schema: {schema}
History: {chat_history}
Question: {question}

SQL:"""

    prompt = ChatPromptTemplate.from_template(template)
    llm = ChatGroq(api_key=GROQ_API_KEY, model="llama-3.1-8b-instant", temperature=0)

    return (
        RunnablePassthrough.assign(schema=lambda _: schema)
        | prompt
        | llm
        | StrOutputParser()
    )


# ---------------------------------------------------------------------------
# Main query handler
# ---------------------------------------------------------------------------
def run_query(
    question: str,
    sql_db: SQLDatabase,
    history: List,
    uri: str,
    schema: str,
    db_type: str,
) -> str:
    """Generate SQL, execute it, and return a structured JSON string."""

    # Cache hit
    cached = query_cache.get(question, uri, history)
    if cached:
        return cached

    chain = build_sql_chain(schema, db_type)
    formatted_history = "\n".join(
        f"{'Human' if isinstance(m, HumanMessage) else 'AI'}: {m.content}"
        for m in history[-6:]
    )

    # BUG FIX: define sql_query before try so the except block always has it
    sql_query = "N/A"
    try:
        raw_response = chain.invoke({"question": question, "chat_history": formatted_history})

        # Strip accidental markdown fences
        sql_query = re.sub(r"^```sql\s*", "", raw_response.strip(), flags=re.IGNORECASE)
        sql_query = re.sub(r"\s*```$", "", sql_query).strip()

        # Keep only the first statement
        if sql_query.count(";") > 1:
            sql_query = sql_query.split(";")[0] + ";"

        sql_query = sanitize_sql(sql_query)
        logger.info("Generated SQL: %s", sql_query)

        dangers = detect_dangerous_sql(sql_query)
        if dangers:
            return json.dumps({
                "type": "confirmation_required",
                "sql": sql_query,
                "table": sql_to_table_preview(sql_query),
                "warnings": dangers,
            })

        raw_result = sql_db.run(sql_query)
        logger.debug("Raw DB result: %s", raw_result)

        is_read = sql_query.upper().startswith("SELECT") or "SHOW" in sql_query.upper()

        if is_read:
            columns = get_columns_from_query(uri, sql_query)
            clean = raw_result.strip()

            if not clean or clean == "[]" or "Empty set" in clean:
                output = {"type": "select", "data": [], "columns": columns, "row_count": 0}
            elif clean.startswith("[") and clean.endswith("]"):
                if db_type == DatabaseType.POSTGRESQL:
                    rows_raw = parse_pg_result(clean)
                else:
                    # MySQL: handle Decimal objects from repr strings
                    cleaned = re.sub(r"Decimal\('([^']+)'\)", r"'\1'", clean)
                    try:
                        rows_raw = ast.literal_eval(cleaned)
                    except Exception:
                        rows_raw = []

                def cell_to_str(c) -> str:
                    if c is None:
                        return ""
                    if isinstance(c, bytes):
                        return c.decode("utf-8", errors="replace")
                    return str(c)

                if rows_raw and isinstance(rows_raw[0], (tuple, list)):
                    data = [[cell_to_str(c) for c in row] for row in rows_raw]
                else:
                    data = [[cell_to_str(item)] for item in rows_raw]

                if data and not columns:
                    columns = [f"column_{i}" for i in range(len(data[0]))]

                output = {"type": "select", "data": data, "columns": columns, "row_count": len(data)}
            else:
                output = {"type": "error", "message": f"Unexpected format: {clean[:200]}"}
        else:
            # DML / DDL
            clean = raw_result.strip()
            m = re.search(r"(\d+)\s+rows?\s+affected", clean, re.IGNORECASE)
            affected = int(m.group(1)) if m else 0
            output = {
                "type": "status",
                "message": f"Executed successfully. {affected} row(s) affected.",
                "affected_rows": affected,
            }

        final = f"SQL: `{sql_query}`\nOutput: {json.dumps(output)}"
        query_cache.set(question, uri, history, final)
        return final

    except Exception as exc:
        logger.error("Query execution error: %s", exc)
        output = {"type": "error", "message": str(exc)}
        return f"SQL: `{sql_query}`\nOutput: {json.dumps(output)}"


# ---------------------------------------------------------------------------
# App lifespan (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    validate_environment()

    # Ensure is_starred column exists (migration guard)
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT name FROM pragma_table_info('chat_sessions') WHERE name='is_starred'")
            )
            if not result.fetchone():
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN is_starred INTEGER DEFAULT 0"))
                conn.commit()
                logger.info("Added is_starred column")
    except Exception as exc:
        logger.warning("Migration check warning: %s", exc)

    logger.info("Query Genie started")
    yield
    # Shutdown
    db_pool.clear_all()
    schema_cache.clear_all()
    query_cache.clear()
    logger.info("Query Genie shutdown complete")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
limiter = Limiter(key_func=get_remote_address)
app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "error": "Rate Limit Exceeded",
            "message": "Too many requests. Please try again later.",
            "retry_after": 60,
        },
        headers={"Retry-After": "60"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080", "http://localhost:8081",
        "http://localhost:5173", "http://localhost:3000",
        "http://127.0.0.1:8080", "http://127.0.0.1:8081",
        "http://127.0.0.1:5173", "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Per-request state helpers (replaces app.state global mutation)
# ---------------------------------------------------------------------------
# Stored as a simple module-level object; per-process, not per-request.
# For true multi-tenancy you'd store per-user in a database or session token.
class _AppState:
    db_uri: Optional[str] = None
    db_name: Optional[str] = None
    db_type: Optional[str] = None


_app_state = _AppState()


def require_db_connection():
    if not _app_state.db_uri:
        raise HTTPException(status_code=400, detail="No database connected")
    return _app_state


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database_connected": bool(_app_state.db_uri),
        "database_type": _app_state.db_type,
    }


# ---------------------------------------------------------------------------
# DB connection endpoints
# ---------------------------------------------------------------------------
@app.post("/api/list-databases")
@limiter.limit("20/minute")
async def list_databases(request: Request, creds: DBCredentials):
    uri = build_db_uri(creds.host, creds.port, creds.user, creds.password, creds.db_type)
    try:
        tmp = create_engine(uri, poolclass=pool.NullPool)
        sql, system_dbs = get_list_databases_query(creds.db_type)
        with tmp.connect() as conn:
            rows = conn.execute(text(sql)).fetchall()
        tmp.dispose()
        dbs = [r[0] for r in rows if r[0] not in system_dbs]
        return {"success": True, "databases": dbs, "db_type": creds.db_type}
    except OperationalError as exc:
        msg = str(exc)
        if "Access denied" in msg or "authentication failed" in msg.lower():
            raise HTTPException(401, detail={"error": "Authentication Failed", "message": msg})
        if "Connection refused" in msg or "could not connect" in msg.lower():
            raise HTTPException(503, detail={"error": "Connection Refused", "message": msg})
        raise HTTPException(500, detail={"error": "Connection Error", "message": msg})
    except Exception as exc:
        raise HTTPException(500, detail={"error": "Unknown Error", "message": str(exc)})


@app.post("/api/create-database")
@limiter.limit("10/hour")
async def create_database(request: Request, config: DBCreate):
    """DBCreate.database_name is validated by the Pydantic model itself."""
    uri = build_db_uri(config.host, config.port, config.user, config.password, config.db_type)
    try:
        tmp = create_engine(uri, poolclass=pool.NullPool)
        sql, system_dbs = get_list_databases_query(config.db_type)
        create_sql = get_create_database_sql(config.db_type, config.database_name)

        with tmp.connect() as conn:
            existing = [r[0] for r in conn.execute(text(sql)).fetchall()]
            if config.database_name in existing:
                raise HTTPException(409, detail={"error": "Database Already Exists"})
            if config.db_type == DatabaseType.POSTGRESQL:
                conn.execute(text("COMMIT"))
            conn.execute(text(create_sql))
            if config.db_type != DatabaseType.POSTGRESQL:
                conn.commit()
        tmp.dispose()
        return {"success": True, "database_name": config.database_name}
    except HTTPException:
        raise
    except OperationalError as exc:
        msg = str(exc)
        code = 403 if ("Access denied" in msg or "permission denied" in msg.lower()) else 500
        raise HTTPException(code, detail={"error": "DB Creation Failed", "message": msg})
    except Exception as exc:
        raise HTTPException(500, detail={"error": "Unknown Error", "message": str(exc)})


@app.post("/api/connect")
@limiter.limit("20/minute")
async def connect_db(request: Request, config: DBSelection):
    uri = build_db_uri(config.host, config.port, config.user, config.password, config.db_type, config.database)
    try:
        eng = db_pool.get_engine(uri, config.db_type)
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))

        sql_db = db_pool.get_sql_db(uri, config.db_type)
        schema_cache.get(uri, sql_db)  # pre-warm

        _app_state.db_uri = uri
        _app_state.db_name = config.database
        _app_state.db_type = config.db_type

        logger.info("Connected to %s database: %s", config.db_type, config.database)
        return {"success": True, "database": config.database, "db_type": config.db_type}
    except ProgrammingError as exc:
        msg = str(exc)
        code = 404 if "does not exist" in msg.lower() or "Unknown database" in msg else 400
        raise HTTPException(code, detail={"error": "DB Error", "message": msg})
    except OperationalError as exc:
        msg = str(exc)
        if "Access denied" in msg or "authentication failed" in msg.lower():
            raise HTTPException(401, detail={"error": "Authentication Failed", "message": msg})
        raise HTTPException(503, detail={"error": "Connection Refused", "message": msg})
    except Exception as exc:
        raise HTTPException(500, detail={"error": "Unknown Error", "message": str(exc)})


@app.post("/api/disconnect")
async def disconnect_db():
    if not _app_state.db_uri:
        return {"success": False, "message": "No database connected"}
    db_pool.clear(_app_state.db_uri)
    schema_cache.invalidate(_app_state.db_uri)
    query_cache.clear()
    _app_state.db_uri = None
    _app_state.db_name = None
    _app_state.db_type = None
    return {"success": True, "message": "Disconnected"}


@app.get("/api/tables")
@limiter.limit("30/minute")
async def get_all_tables(request: Request, state=Depends(require_db_connection)):
    try:
        eng = db_pool.get_engine(state.db_uri)
        if state.db_type == DatabaseType.POSTGRESQL:
            with eng.connect() as conn:
                rows = conn.execute(text(
                    "SELECT tablename FROM pg_catalog.pg_tables "
                    "WHERE schemaname NOT IN ('pg_catalog','information_schema') "
                    "ORDER BY tablename"
                )).fetchall()
            tables = [r[0] for r in rows]
        else:
            tables = inspect(eng).get_table_names()
        return {"success": True, "tables": tables, "count": len(tables), "database": state.db_name}
    except Exception as exc:
        raise HTTPException(500, detail=str(exc))


@app.get("/api/table-schema/{table_name}")
@limiter.limit("30/minute")
async def get_table_schema(request: Request, table_name: str, state=Depends(require_db_connection)):
    try:
        eng = db_pool.get_engine(state.db_uri)
        insp = inspect(eng)
        if table_name not in insp.get_table_names():
            raise HTTPException(404, detail=f"Table '{table_name}' not found")

        pk = (insp.get_pk_constraint(table_name) or {}).get("constrained_columns", [])
        fks = [c for fk in insp.get_foreign_keys(table_name) for c in fk.get("constrained_columns", [])]
        uniq = [c for uc in insp.get_unique_constraints(table_name) for c in uc.get("column_names", [])]

        cols = []
        for col in insp.get_columns(table_name):
            name = col["name"]
            key = "PRI" if name in pk else ("MUL" if name in fks else ("UNI" if name in uniq else None))
            cols.append({
                "name": name,
                "type": str(col["type"]),
                "nullable": col.get("nullable", True),
                "key": key,
                "default": str(col["default"]) if col.get("default") is not None else None,
                "autoincrement": col.get("autoincrement", False),
            })
        return {"success": True, "table_name": table_name, "columns": cols}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, detail=str(exc))


@app.post("/api/chat")
@limiter.limit("30/minute")
async def chat_endpoint(request: Request, body: ChatRequest, state=Depends(require_db_connection)):
    history = [
        AIMessage(content=m["content"]) if m["role"] == "ai" else HumanMessage(content=m["content"])
        for m in body.chat_history
    ]
    try:
        sql_db = db_pool.get_sql_db(state.db_uri, state.db_type)
        schema = schema_cache.get(state.db_uri, sql_db)
        result = run_query(body.question, sql_db, history, state.db_uri, schema, state.db_type)
        return {"success": True, "response": result}
    except Exception as exc:
        logger.error("Chat error: %s", exc)
        raise HTTPException(500, detail=str(exc))


@app.post("/api/confirm-sql")
@limiter.limit("20/minute")
async def confirm_sql(request: Request, body: ConfirmSQLRequest, state=Depends(require_db_connection)):
    if not body.confirm:
        return {"type": "status", "message": "SQL execution cancelled"}
    try:
        sql_db = db_pool.get_sql_db(state.db_uri, state.db_type)
        result = sql_db.run(body.sql)
        schema_cache.invalidate(state.db_uri)
        query_cache.clear()
        return {"type": "status", "message": f"Executed. Result: {result}"}
    except Exception as exc:
        return {"type": "error", "message": str(exc)}


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@app.post("/api/send-otp")
@limiter.limit("3/minute")
async def send_signup_otp(request: Request, body: OtpRequest, db: Session = Depends(get_db)):
    otp = generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    db.query(OTP).filter(OTP.email == body.email).delete()
    db.add(OTP(email=body.email, otp=otp, expires_at=expires_at))
    db.commit()
    sent = send_otp_email(body.email, otp)
    logger.info("OTP for %s: %s", body.email, otp)
    return {"success": True, "message": "OTP sent" if sent else "OTP generated (email unavailable)"}


@app.post("/api/signup", status_code=201)
@limiter.limit("5/hour")
async def signup(request: Request, body: UserCreate, db: Session = Depends(get_db)):
    stored = db.query(OTP).filter(OTP.email == body.email).first()
    if not stored:
        raise HTTPException(400, detail="OTP not requested or expired")
    if datetime.now(timezone.utc) > make_tz_aware(stored.expires_at):
        db.delete(stored); db.commit()
        raise HTTPException(400, detail="OTP expired")
    if stored.otp != body.otp:
        raise HTTPException(400, detail="Invalid OTP")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(400, detail="Email already registered")
    if body.phone and db.query(User).filter(User.phone == body.phone).first():
        raise HTTPException(400, detail="Phone already registered")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(400, detail="Username already taken")

    db.add(User(
        email=body.email, phone=body.phone,
        firstName=body.firstName, lastName=body.lastName,
        gender=body.gender, username=body.username,
        hashed_password=get_password_hash(body.password),
    ))
    db.delete(stored)
    db.commit()
    return {"success": True, "message": "User created"}


@app.post("/api/login")
@limiter.limit("10/minute")
async def login(request: Request, body: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        (User.email == body.identifier) | (User.username == body.identifier)
    ).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(401, detail="Incorrect credentials")
    return {
        "success": True,
        "user": {
            "id": user.id, "email": user.email, "phone": user.phone,
            "firstName": user.firstName, "lastName": user.lastName,
            "username": user.username, "gender": user.gender,
        },
    }


@app.post("/api/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    # Always return the same message to prevent user enumeration
    if not user:
        return {"success": True, "message": "If that email exists, a reset code has been sent."}

    otp = generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.query(PasswordResetOTP).filter(PasswordResetOTP.email == body.email).delete()
    db.add(PasswordResetOTP(email=body.email, otp=otp, expires_at=expires_at))
    db.commit()
    send_password_reset_email(body.email, otp)
    logger.info("Password reset OTP for %s: %s", body.email, otp)
    return {"success": True, "message": "Reset code sent (if account exists)"}


# BUG FIX: was accepting raw dict – now uses VerifyResetOTPRequest Pydantic model
@app.post("/api/verify-reset-otp")
@limiter.limit("5/minute")
async def verify_reset_otp(request: Request, body: VerifyResetOTPRequest, db: Session = Depends(get_db)):
    stored = db.query(PasswordResetOTP).filter(PasswordResetOTP.email == body.email).first()
    if not stored:
        raise HTTPException(400, detail="Reset code not found or expired")
    if datetime.now(timezone.utc) > make_tz_aware(stored.expires_at):
        db.delete(stored); db.commit()
        raise HTTPException(400, detail="Reset code expired")
    if stored.otp != body.otp:
        raise HTTPException(400, detail="Invalid reset code")
    return {"success": True, "message": "Reset code verified"}


@app.post("/api/reset-password")
@limiter.limit("5/minute")
async def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    stored = db.query(PasswordResetOTP).filter(PasswordResetOTP.email == body.email).first()
    if not stored:
        raise HTTPException(400, detail="Reset code not found or expired")
    if datetime.now(timezone.utc) > make_tz_aware(stored.expires_at):
        db.delete(stored); db.commit()
        raise HTTPException(400, detail="Reset code expired")
    if stored.otp != body.otp:
        raise HTTPException(400, detail="Invalid reset code")

    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(404, detail="User not found")

    user.hashed_password = get_password_hash(body.new_password)
    db.delete(stored)
    db.commit()
    return {"success": True, "message": "Password reset successfully"}


@app.post("/api/resend-reset-otp")
@limiter.limit("3/minute")
async def resend_reset_otp(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        return {"success": True, "message": "If that email exists, a new code has been sent."}

    existing = db.query(PasswordResetOTP).filter(PasswordResetOTP.email == body.email).first()
    if existing:
        age = datetime.now(timezone.utc) - make_tz_aware(existing.created_at)
        if age < timedelta(minutes=1):
            wait = 60 - int(age.total_seconds())
            return {"success": False, "message": f"Wait {wait}s before requesting a new code"}

    otp = generate_otp()
    db.query(PasswordResetOTP).filter(PasswordResetOTP.email == body.email).delete()
    db.add(PasswordResetOTP(email=body.email, otp=otp, expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)))
    db.commit()
    send_password_reset_email(body.email, otp)
    return {"success": True, "message": "New reset code sent"}


# ---------------------------------------------------------------------------
# Chat sessions
# ---------------------------------------------------------------------------
@app.get("/api/chat-sessions")
@limiter.limit("60/minute")
async def get_chat_sessions(request: Request, user_id: int = Query(...), db: Session = Depends(get_db)):
    sessions = db.query(ChatSession).filter(ChatSession.user_id == user_id).order_by(ChatSession.id.desc()).all()
    return [
        {
            "id": s.id,
            "user_id": s.user_id,
            "title": s.title,
            "messages": json.loads(s.messages),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "isStarred": bool(s.is_starred),
        }
        for s in sessions
    ]


# BUG FIX: was missing @app.post decorator entirely – the route was unreachable
@app.post("/api/chat-sessions", status_code=201)
@limiter.limit("30/minute")
async def create_chat_session(request: Request, body: CreateSessionRequest, db: Session = Depends(get_db)):
    s = ChatSession(
        user_id=body.user_id,
        title=body.title,
        messages=json.dumps(body.messages),
        is_starred=1 if body.isStarred else 0,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {
        "id": s.id, "user_id": s.user_id, "title": s.title,
        "messages": json.loads(s.messages),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "isStarred": bool(s.is_starred),
    }


# BUG FIX: was using raw SessionLocal() instead of Depends(get_db)
@app.put("/api/chat-sessions/{session_id}")
@limiter.limit("60/minute")
async def update_chat_session(
    request: Request, session_id: int, body: dict, db: Session = Depends(get_db)
):
    s = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not s:
        raise HTTPException(404, detail="Session not found")
    if s.user_id != body.get("user_id"):
        raise HTTPException(403, detail="Unauthorized")
    s.title = body.get("title", s.title)
    if "messages" in body:
        s.messages = json.dumps(body["messages"])
    db.commit()
    return {
        "id": s.id, "user_id": s.user_id, "title": s.title,
        "messages": json.loads(s.messages),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# BUG FIX: was using raw SessionLocal() instead of Depends(get_db)
@app.delete("/api/chat-sessions/{session_id}")
@limiter.limit("30/minute")
async def delete_chat_session(
    request: Request, session_id: int, user_id: int = Query(...), db: Session = Depends(get_db)
):
    s = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not s:
        return {"success": True, "message": "Session not found or already deleted"}
    if s.user_id != user_id:
        raise HTTPException(403, detail="Unauthorized")
    db.delete(s)
    db.commit()
    return {"success": True, "message": "Session deleted"}


@app.put("/api/chat-sessions/{session_id}/star")
@limiter.limit("30/minute")
async def toggle_star(
    request: Request, session_id: int, body: StarSessionRequest, db: Session = Depends(get_db)
):
    s = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == body.user_id).first()
    if not s:
        raise HTTPException(404, detail="Session not found")
    s.is_starred = 1 if body.is_starred else 0
    db.commit()
    return {"success": True, "is_starred": body.is_starred}


@app.put("/api/chat-sessions/{session_id}/rename")
@limiter.limit("30/minute")
async def rename_session(
    request: Request, session_id: int, body: RenameSessionRequest, db: Session = Depends(get_db)
):
    if not body.title.strip():
        raise HTTPException(400, detail="Title cannot be empty")
    s = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == body.user_id).first()
    if not s:
        raise HTTPException(404, detail="Session not found")
    s.title = body.title.strip()
    db.commit()
    return {"success": True, "title": s.title}


# ---------------------------------------------------------------------------
# Profile endpoints
# ---------------------------------------------------------------------------
@app.put("/api/update-profile")
@limiter.limit("10/minute")
async def update_profile(request: Request, body: UpdateProfileRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == body.userId).first()
    if not user:
        raise HTTPException(404, detail="User not found")

    # Uniqueness checks (excluding current user)
    if body.email != user.email and db.query(User).filter(User.email == body.email, User.id != body.userId).first():
        raise HTTPException(400, detail="Email already in use")
    if body.username != user.username and db.query(User).filter(User.username == body.username, User.id != body.userId).first():
        raise HTTPException(400, detail="Username already taken")
    if body.phone and body.phone != user.phone and db.query(User).filter(User.phone == body.phone, User.id != body.userId).first():
        raise HTTPException(400, detail="Phone already registered")

    user.firstName = body.firstName
    user.lastName = body.lastName
    user.username = body.username
    user.email = body.email
    user.phone = body.phone
    user.gender = body.gender
    db.commit()
    db.refresh(user)
    return {
        "success": True,
        "user": {
            "id": user.id, "firstName": user.firstName, "lastName": user.lastName,
            "username": user.username, "email": user.email,
            "phone": user.phone, "gender": user.gender,
        },
    }


@app.post("/api/change-password")
@limiter.limit("5/minute")
async def change_password(request: Request, body: ChangePasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == body.userId).first()
    if not user:
        raise HTTPException(404, detail="User not found")
    if not verify_password(body.currentPassword, user.hashed_password):
        raise HTTPException(400, detail="Current password incorrect")
    if verify_password(body.newPassword, user.hashed_password):
        raise HTTPException(400, detail="New password must differ from current")
    user.hashed_password = get_password_hash(body.newPassword)
    db.commit()
    return {"success": True, "message": "Password changed"}


@app.post("/api/send-email-change-otp")
@limiter.limit("3/minute")
async def send_email_change_otp_endpoint(request: Request, body: SendEmailOTPRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == body.userId).first()
    if not user:
        raise HTTPException(404, detail="User not found")
    if db.query(User).filter(User.email == body.newEmail, User.id != body.userId).first():
        raise HTTPException(400, detail="Email already in use")

    otp = generate_otp()
    db.query(ProfileUpdateOTP).filter(ProfileUpdateOTP.user_id == body.userId).delete()
    db.add(ProfileUpdateOTP(
        user_id=body.userId, otp=otp, new_email=body.newEmail,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    ))
    db.commit()
    send_email_change_otp(body.newEmail, otp, f"{user.firstName} {user.lastName}")
    return {"success": True, "message": f"OTP sent to {body.newEmail}"}


@app.put("/api/update-email")
@limiter.limit("10/minute")
async def update_email(request: Request, body: UpdateEmailRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == body.userId).first()
    if not user:
        raise HTTPException(404, detail="User not found")
    rec = db.query(ProfileUpdateOTP).filter(ProfileUpdateOTP.user_id == body.userId).first()
    if not rec:
        raise HTTPException(400, detail="OTP not found or expired")
    if datetime.now(timezone.utc) > make_tz_aware(rec.expires_at):
        db.delete(rec); db.commit()
        raise HTTPException(400, detail="OTP expired")
    if rec.otp != body.otp:
        raise HTTPException(400, detail="Invalid OTP")
    if rec.new_email != body.newEmail:
        raise HTTPException(400, detail="Email mismatch")

    user.email = body.newEmail
    db.delete(rec)
    db.commit()
    db.refresh(user)
    return {
        "success": True,
        "user": {
            "id": user.id, "email": user.email,
            "firstName": user.firstName, "lastName": user.lastName,
            "username": user.username, "phone": user.phone, "gender": user.gender,
        },
    }


# ---------------------------------------------------------------------------
# Debug
# ---------------------------------------------------------------------------
@app.get("/api/cache-stats")
async def cache_stats():
    return {
        "schema_cache_size": len(schema_cache._cache),
        "query_cache_size": len(query_cache._cache),
        "connection_pools": len(db_pool._engines),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)