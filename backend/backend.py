import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Query, Request 
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from passlib.context import CryptContext
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser
from langchain_community.utilities import SQLDatabase
from langchain_groq import ChatGroq
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, inspect, text, pool
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.exc import SQLAlchemyError, OperationalError, ProgrammingError
import ast
import json
import re
from functools import lru_cache
from typing import Dict, Optional
import hashlib
import logging
from urllib.parse import quote_plus 
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
groq_api_key = os.getenv("GROQ_API_KEY")
assert groq_api_key is not None, "GROQ_API_KEY not found in environment variables"

# EMAIL CONFIGURATION
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD")
if not EMAIL_HOST_USER or not EMAIL_HOST_PASSWORD:
    print("WARNING: Email credentials not found. OTP sending will be disabled.")

def validate_environment():
    """Check required variables at startup"""
    required = {
        "GROQ_API_KEY": groq_api_key,
        "EMAIL_HOST_USER": EMAIL_HOST_USER,
        "EMAIL_HOST_PASSWORD": EMAIL_HOST_PASSWORD
    }
    
    # Check critical variables
    if not groq_api_key:
        raise RuntimeError("❌ Missing critical: GROQ_API_KEY")
    
    # Warn about optional variables
    if not EMAIL_HOST_USER or not EMAIL_HOST_PASSWORD:
        logger.warning("⚠️ Email credentials missing - OTP will be disabled")
    
    logger.info("✅ All required environment variables present")

# Password Hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ============= TIMEZONE HELPER =============
def make_tz_aware(dt):
    """Make datetime timezone-aware if it's naive (SQLite compatibility)"""
    if dt and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt

# ============= ✅ FIX #1: CONNECTION POOL CACHE =============
class DatabaseConnectionPool:
    """Maintains connection pools for MySQL databases"""
    def __init__(self):
        self._pools: Dict[str, create_engine] = {}
        self._db_instances: Dict[str, SQLDatabase] = {}
    
    def get_engine(self, db_uri: str):
        """Get or create connection pool for a database"""
        if db_uri not in self._pools:
            print(f"[POOL] Creating new connection pool for {db_uri}")
            self._pools[db_uri] = create_engine(
                db_uri,
                poolclass=pool.QueuePool,
                pool_size=10,
                max_overflow=20,
                pool_timeout=30,
                pool_recycle=3600,
                pool_pre_ping=True,
                echo=False
            )
        return self._pools[db_uri]
    
    def get_db(self, db_uri: str) -> SQLDatabase:
        """Get or create SQLDatabase instance with pooled connection"""
        if db_uri not in self._db_instances:
            print(f"[POOL] Creating new SQLDatabase instance for {db_uri}")
            engine = self.get_engine(db_uri)
            self._db_instances[db_uri] = SQLDatabase(engine)
        return self._db_instances[db_uri]
    
    def clear_pool(self, db_uri: str):
        """Clear connection pool for a specific database"""
        if db_uri in self._pools:
            self._pools[db_uri].dispose()
            del self._pools[db_uri]
        if db_uri in self._db_instances:
            del self._db_instances[db_uri]

# Global connection pool manager
db_pool_manager = DatabaseConnectionPool()

# ============= ✅ FIX #2: SCHEMA CACHING =============
class SchemaCache:
    """Cache database schemas to avoid repeated fetching"""
    def __init__(self):
        self._cache: Dict[str, str] = {}
        self._last_updated: Dict[str, datetime] = {}
        self._ttl = timedelta(minutes=30)  # Cache for 30 minutes
    
    def get_schema(self, db_uri: str, db: SQLDatabase) -> str:
        """Get cached schema or fetch and cache it"""
        cache_key = db_uri
        now = datetime.now(timezone.utc)
        
        # Check if cache exists and is not expired
        if cache_key in self._cache:
            if cache_key in self._last_updated:
                age = now - self._last_updated[cache_key]
                if age < self._ttl:
                    print(f"[CACHE] Using cached schema (age: {age.seconds}s)")
                    return self._cache[cache_key]
        
        # Fetch fresh schema
        print("[CACHE] Fetching fresh schema...")
        schema = db.get_table_info()
        self._cache[cache_key] = schema
        self._last_updated[cache_key] = now
        return schema
    
    def invalidate(self, db_uri: str):
        """Invalidate cache for a specific database"""
        if db_uri in self._cache:
            del self._cache[db_uri]
        if db_uri in self._last_updated:
            del self._last_updated[db_uri]

# Global schema cache
schema_cache = SchemaCache()

# ============= ✅ FIX #3: QUERY RESULT CACHING =============
class QueryCache:
    """Cache query results for identical queries"""
    def __init__(self, max_size: int = 100):
        self._cache: Dict[str, dict] = {}
        self._max_size = max_size
    
    def _make_key(self, question: str, db_uri: str, chat_history: list) -> str:
        """Create cache key from query parameters"""
        # Only cache if chat history is short (last 2 messages)
        if len(chat_history) > 4:
            return None
        
        history_str = json.dumps([msg.content for msg in chat_history[-4:]])
        content = f"{question}|{db_uri}|{history_str}"
        return hashlib.md5(content.encode()).hexdigest()
    
    def get(self, question: str, db_uri: str, chat_history: list) -> Optional[dict]:
        """Get cached result"""
        key = self._make_key(question, db_uri, chat_history)
        if key and key in self._cache:
            print("[CACHE] Using cached query result")
            return self._cache[key]
        return None
    
    def set(self, question: str, db_uri: str, chat_history: list, result: dict):
        """Cache query result"""
        key = self._make_key(question, db_uri, chat_history)
        if not key:
            return
        
        # Simple LRU: remove oldest if cache is full
        if len(self._cache) >= self._max_size:
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]
        
        self._cache[key] = result
    
    def clear(self):
        """Clear all cached queries"""
        self._cache.clear()

# Global query cache
query_cache = QueryCache(max_size=50)

# ============= DATABASE SETUP WITH CONNECTION POOLING =============
SQLITE_DB_FILE = "users.db"

# Connection pooling for SQLite (users database)
engine = create_engine(
    f"sqlite:///{SQLITE_DB_FILE}",
    echo=False,
    poolclass=pool.QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,
    pool_recycle=3600,
    pool_pre_ping=True
)

Base = declarative_base()

# ============= DATABASE MODELS =============
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
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    title = Column(String, nullable=False)
    messages = Column(Text, nullable=False)

class OTP(Base):
    __tablename__ = "otps"
    email = Column(String, primary_key=True, index=True)
    otp = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class ProfileUpdateOTP(Base):
    """OTP for email change verification"""
    __tablename__ = "profile_update_otps"
    user_id = Column(Integer, primary_key=True, index=True)
    otp = Column(String, nullable=False)
    new_email = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class PasswordResetOTP(Base):
    """New table for password reset OTPs"""
    __tablename__ = "password_reset_otps"
    email = Column(String, primary_key=True, index=True)
    otp = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

# Create all tables
Base.metadata.create_all(engine)

# Session factory with connection pooling
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

app = FastAPI()

# ============= RATE LIMITING SETUP =============
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
# Custom error handler for rate limit exceeded
@app.exception_handler(RateLimitExceeded)
async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """
    Returns user-friendly error message when rate limit is exceeded
    Status code 429 = Too Many Requests
    """
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "error": "Rate Limit Exceeded",
            "message": "Too many requests. Please slow down and try again later.",
            "detail": str(exc.detail),
            "retry_after": 60
        },
        headers={
            "Retry-After": "60" 
        }
    )

# CORS Middleware
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
    expose_headers=["*"],
)
# ============= STARTUP EVENT =============
@app.on_event("startup")
async def startup_event():
    """Validate environment on startup"""
    validate_environment()
    
    # ✅ Verify slowapi is working
    try:
        import slowapi
        version = getattr(slowapi, '__version__', 'unknown')
        logger.info(f"✅ Rate limiting enabled (slowapi v{version})")
    except ImportError:
        logger.warning("⚠️ slowapi not installed - rate limiting will not work!")
    except Exception as e:
        logger.warning(f"⚠️ Rate limiting may not be working: {e}")
    
    logger.info("🚀 Application started successfully")

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up resources on shutdown"""
    logger.info("🛑 Shutting down application...")
    
    # Close all connection pools
    for db_uri in list(db_pool_manager._pools.keys()):
        db_pool_manager.clear_pool(db_uri)
    
    # Clear all caches
    schema_cache._cache.clear()
    query_cache.clear()
    
    logger.info("✅ Cleanup completed")

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database_connected": hasattr(app.state, "db_uri"),
        "cache_stats": {
            "schema_cache": len(schema_cache._cache),
            "query_cache": len(query_cache._cache),
            "connection_pools": len(db_pool_manager._pools)
        }
    }

# Pydantic Models
class DBConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str = ""
    database: str

# Add these two new models after DBConfig
class DBCredentials(BaseModel):
    """Step 1: Verify credentials without database"""
    host: str
    port: int
    user: str
    password: str = ""

class DBSelection(BaseModel):
    """Step 2: Connect to selected database"""
    host: str
    port: int
    user: str
    password: str = ""
    database: str

class DBCreate(BaseModel):
    """Step 2.5: Create new database"""
    host: str
    port: int
    user: str
    password: str = ""
    database_name: str  # New database name to create

class ChatRequest(BaseModel):
    question: str
    chat_history: list

class UserCreate(BaseModel):
    firstName: str
    lastName: str
    email: EmailStr
    phone: str = None
    password: str
    otp: str
    gender: str
    username: str

class UserLogin(BaseModel):
    identifier: str
    password: str

class OtpRequest(BaseModel):
    email: EmailStr

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

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
    phone: str
    gender: str

class ChangePasswordRequest(BaseModel):
    userId: int
    currentPassword: str
    newPassword: str

class SendEmailOTPRequest(BaseModel):
    userId: int
    newEmail: EmailStr

class UpdateEmailRequest(BaseModel):
    userId: int
    newEmail: EmailStr
    otp: str

# Database Session Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Helper Functions
def generate_otp():
    return str(random.randint(100000, 999999))

def send_otp_email(recipient_email: str, otp: str) -> bool:
    """Best-effort OTP email sender."""
    if not EMAIL_HOST_USER or not EMAIL_HOST_PASSWORD:
        print(f"[OTP] Email credentials missing; OTP for {recipient_email}: {otp}")
        return False

    message = MIMEMultipart("alternative")
    message["Subject"] = "Your Verification Code"
    message["From"] = EMAIL_HOST_USER
    message["To"] = recipient_email

    html = f"""
    <html>
    <body>
        <div style="font-family: Arial, sans-serif; text-align: center; color: #333;">
            <h2>Welcome to Query Genie!</h2>
            <p>Your one-time verification code is:</p>
            <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #007BFF;">{otp}</p>
            <p>This code will expire in 5 minutes.</p>
        </div>
    </body>
    </html>
    """
    message.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(EMAIL_HOST_USER, EMAIL_HOST_PASSWORD)
            server.sendmail(EMAIL_HOST_USER, recipient_email, message.as_string())
        print(f"[OTP] Email sent to {recipient_email}")
        return True
    except Exception as e:
        print(f"[OTP] Failed to send email to {recipient_email}: {e}")
        return False
    
def send_password_reset_email(recipient_email: str, otp: str) -> bool:
    """Send password reset OTP email"""
    if not EMAIL_HOST_USER or not EMAIL_HOST_PASSWORD:
        print(f"[PASSWORD RESET] Missing credentials; OTP for {recipient_email}: {otp}")
        return False
    
    message = MIMEMultipart("alternative")
    message["Subject"] = "Password Reset Code - Query Genie"
    message["From"] = EMAIL_HOST_USER
    message["To"] = recipient_email
    
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5;">
        <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0;">Password Reset</h1>
            </div>
            
            <div style="padding: 30px;">
                <p style="color: #666; margin-bottom: 20px;">
                    Use this code to reset your Query Genie password:
                </p>
                
                <div style="text-align: center; margin: 25px 0;">
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border: 2px dashed #667eea;">
                        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea;">
                            {otp}
                        </span>
                    </div>
                </div>
                
                <p style="color: #666; font-size: 14px;">
                    Expires in <strong>10 minutes</strong>. Didn't request this? Ignore this email.
                </p>
            </div>
        </div>
    </body>
    </html>
    """
    
    message.attach(MIMEText(html, "html"))
    
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(EMAIL_HOST_USER, EMAIL_HOST_PASSWORD)
            server.sendmail(EMAIL_HOST_USER, recipient_email, message.as_string())
        print(f"[PASSWORD RESET] Sent to {recipient_email}")
        return True
    except Exception as e:
        print(f"[PASSWORD RESET] Failed for {recipient_email}: {e}")
        return False

def send_email_change_otp(recipient_email: str, otp: str, user_name: str) -> bool:
    """Send OTP to verify new email address"""
    if not EMAIL_HOST_USER or not EMAIL_HOST_PASSWORD:
        print(f"[EMAIL CHANGE] Missing credentials; OTP for {recipient_email}: {otp}")
        return False
    
    message = MIMEMultipart("alternative")
    message["Subject"] = "Verify Your New Email - Query Genie"
    message["From"] = EMAIL_HOST_USER
    message["To"] = recipient_email
    
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5;">
        <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0;">Verify New Email</h1>
            </div>
            
            <div style="padding: 30px;">
                <p style="color: #333; margin-bottom: 10px;">Hi <strong>{user_name}</strong>,</p>
                
                <p style="color: #666; margin-bottom: 20px;">
                    You're changing your email address. Use this code to verify:
                </p>
                
                <div style="text-align: center; margin: 25px 0;">
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border: 2px dashed #667eea;">
                        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea;">
                            {otp}
                        </span>
                    </div>
                </div>
                
                <p style="color: #666; font-size: 14px;">
                    <strong>Expires in 5 minutes.</strong> If you didn't request this, ignore this email.
                </p>
            </div>
        </div>
    </body>
    </html>
    """
    
    message.attach(MIMEText(html, "html"))
    
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(EMAIL_HOST_USER, EMAIL_HOST_PASSWORD)
            server.sendmail(EMAIL_HOST_USER, recipient_email, message.as_string())
        print(f"[EMAIL CHANGE] OTP sent to {recipient_email}")
        return True
    except Exception as e:
        print(f"[EMAIL CHANGE] Failed for {recipient_email}: {e}")
        return False
    
# SQL Safety
DANGEROUS_KEYWORDS = ["DROP", "TRUNCATE", "DELETE", "ALTER", "UPDATE"]
FORBIDDEN_PATTERNS = [
    r";\s*DROP", r"--", r"/\*.*\*/", r"UNION\s+SELECT",
    r"OR\s+1\s*=\s*1", r"AND\s+1\s*=\s*1", r"'\s*OR\s*'",
    r";\s*EXEC", r"xp_cmdshell",
]

def detect_dangerous_sql(sql: str):
    sql_upper = sql.upper()
    dangerous = [kw for kw in DANGEROUS_KEYWORDS if kw in sql_upper]
    for pattern in FORBIDDEN_PATTERNS:
        if re.search(pattern, sql, re.IGNORECASE):
            dangerous.append(f"INJECTION_PATTERN: {pattern}")
    return dangerous

def sanitize_sql_input(sql: str) -> str:
    sql = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    return sql.strip()

def sql_to_table_preview(sql: str):
    sql_upper = sql.upper()
    action = "UNKNOWN"
    table = "-"
    condition = "-"

    if sql_upper.startswith("DELETE"):
        action = "DELETE"
        match = re.search(r"FROM\s+`?(\w+)`?", sql_upper)
        if match:
            table = match.group(1)
        where_match = re.search(r"WHERE\s+(.+)", sql, re.IGNORECASE)
        if where_match:
            condition = where_match.group(1)
    elif sql_upper.startswith("UPDATE"):
        action = "UPDATE"
        match = re.search(r"UPDATE\s+`?(\w+)`?", sql_upper)
        if match:
            table = match.group(1)
        where_match = re.search(r"WHERE\s+(.+)", sql, re.IGNORECASE)
        if where_match:
            condition = where_match.group(1)
    elif sql_upper.startswith("DROP"):
        action = "DROP"
        match = re.search(r"DROP\s+TABLE\s+`?(\w+)`?", sql_upper)
        if match:
            table = match.group(1)

    return {
        "columns": ["Action", "Table", "Condition", "Impact"],
        "data": [[action, table, condition, "Removes/modifies record(s) permanently"]]
    }

# Auth Helpers
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def get_user(identifier: str, db):
    return db.query(User).filter(
        (User.email == identifier) | (User.username == identifier)
    ).first()

# ============= ✅ FIX #4: OPTIMIZED COLUMN DETECTION =============
@lru_cache(maxsize=128)
def get_columns_cached(db_uri: str, table_name: str) -> tuple:
    """Cached column detection"""
    try:
        engine = db_pool_manager.get_engine(db_uri)
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns(table_name)]
        return tuple(columns)
    except Exception as e:
        print(f"Error getting columns: {e}")
        return tuple()

def get_columns_from_query_result(db_uri: str, sql_query: str) -> list:
    try:
        engine = db_pool_manager.get_engine(db_uri)
        with engine.connect() as conn:
            result = conn.execute(text(sql_query))
            columns = list(result.keys())
            return columns
    except Exception as e:
        print(f"Error getting columns: {e}")
        return []

def extract_table_name_from_query(sql_query: str) -> str:
    try:
        patterns = [
            r'FROM\s+`?(\w+)`?',
            r'JOIN\s+`?(\w+)`?',
            r'INTO\s+`?(\w+)`?',
            r'UPDATE\s+`?(\w+)`?',
        ]
        for pattern in patterns:
            match = re.search(pattern, sql_query, re.IGNORECASE)
            if match:
                return match.group(1)
        return None
    except Exception as e:
        return None

# ============= ✅ FIX #5: OPTIMIZED LANGCHAIN WITH CACHING =============
def get_sql_chain(cached_schema: str):
    """Create LangChain with pre-fetched schema and improved prompt"""
    template = """You are a MySQL expert. Generate ONLY valid MySQL statements - no explanations, markdown, or extra text.

QUERY PATTERNS:
- "show tables" / "list tables" → SHOW TABLES;
- "show all data" / "all records from X" → SELECT * FROM X;
- "count" / "how many" / "total" → SELECT COUNT(*) as count FROM table;
- "table count" / "number of tables" → SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = DATABASE();
- "table names list" → SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE();
- "current database" / "database name" / "which database" → SELECT DATABASE() as current_database;
- "all databases" / "list databases" → SHOW DATABASES;

RULES:
- Return ONLY SQL, no ```sql blocks or comments
- Never mix COUNT(*) with non-aggregated columns without GROUP BY
- Use DATABASE() for current database, SHOW DATABASES for all databases

Schema: {schema}
History: {chat_history}
Question: {question}

SQL:"""
    
    prompt = ChatPromptTemplate.from_template(template)
    llm = ChatGroq(api_key=groq_api_key, model="llama-3.1-8b-instant", temperature=0)
    
    def get_schema(_):
        return cached_schema
    
    return (
        RunnablePassthrough.assign(schema=get_schema)
        | prompt
        | llm
        | StrOutputParser()
    )

def get_response(question, db, chat_history, db_uri, cached_schema):
    """Optimized response generation with better handling for SHOW commands"""
    
    # Check query cache first
    cached_result = query_cache.get(question, db_uri, chat_history)
    if cached_result:
        return cached_result
    
    chain = get_sql_chain(cached_schema)
    formatted_chat_history = "\n".join([
        f"{'Human' if isinstance(msg, HumanMessage) else 'AI'}: {msg.content}"
        for msg in chat_history[-6:]
    ])
    
    try:
        response_text = chain.invoke({
            "question": question,
            "chat_history": formatted_chat_history
        })
        
        # Clean the SQL query
        sql_query = response_text.strip()
        sql_query = re.sub(r'^```sql\s*', '', sql_query)
        sql_query = re.sub(r'\s*```$', '', sql_query)
        sql_query = sql_query.strip()
        
        # Remove any trailing semicolons if there are multiple
        if sql_query.count(';') > 1:
            sql_query = sql_query.split(';')[0] + ';'
        
        sql_query = sanitize_sql_input(sql_query)
        
        # Check for dangerous operations
        dangerous_ops = detect_dangerous_sql(sql_query)
        
        if dangerous_ops:
            result = json.dumps({
                "type": "confirmation_required",
                "sql": sql_query,
                "table": sql_to_table_preview(sql_query),
                "warnings": dangerous_ops
            })
            return result
        
        sql_upper = sql_query.upper()
        
        # Handle SHOW commands specially
        is_show_command = sql_upper.startswith('SHOW')
        is_select = sql_upper.startswith('SELECT')
        
        # Execute the query
        result = db.run(sql_query)
        
        # Parse results based on query type
        if is_show_command:
            # Handle SHOW TABLES specifically
            if 'TABLES' in sql_upper:
                clean_result = result.strip()
                
                # Parse the result
                if clean_result == '[]' or not clean_result:
                    output_data = {
                        "type": "select",
                        "data": [],
                        "columns": ["Tables"],
                        "row_count": 0
                    }
                else:
                    try:
                        # Parse table names from result
                        cleaned = re.sub(r"Decimal\('([^']+)'\)", r"'\1'", clean_result)
                        cleaned = cleaned.replace("'", '"').replace('None', 'null')
                        
                        try:
                            raw_data = json.loads(cleaned)
                        except:
                            raw_data = ast.literal_eval(clean_result)
                        
                        # Extract table names
                        table_names = []
                        if isinstance(raw_data, list):
                            for item in raw_data:
                                if isinstance(item, (tuple, list)) and len(item) > 0:
                                    table_names.append([str(item[0])])
                                elif isinstance(item, str):
                                    table_names.append([item])
                        
                        output_data = {
                            "type": "select",
                            "data": table_names,
                            "columns": [f"Tables_in_{app.state.db_name}"] if hasattr(app.state, 'db_name') else ["Tables"],
                            "row_count": len(table_names)
                        }
                    except Exception as e:
                        print(f"Error parsing SHOW TABLES: {e}, raw result: {clean_result}")
                        output_data = {
                            "type": "error",
                            "message": f"Failed to parse tables: {str(e)}"
                        }
            else:
                # Other SHOW commands
                output_data = {
                    "type": "status",
                    "message": result.strip()
                }
        
        elif is_select:
            # Handle SELECT queries
            columns = get_columns_from_query_result(db_uri, sql_query)
            if not columns:
                table_name = extract_table_name_from_query(sql_query)
                if table_name:
                    columns = list(get_columns_cached(db_uri, table_name))
            
            clean_result = result.strip()
            
            if clean_result == '[]' or clean_result == '' or 'Empty set' in clean_result:
                output_data = {
                    "type": "select",
                    "data": [],
                    "columns": columns or [],
                    "row_count": 0
                }
            elif clean_result.startswith('[') and clean_result.endswith(']'):
                try:
                    cleaned = re.sub(r"Decimal\('([^']+)'\)", r"'\1'", clean_result)
                    try:
                        raw_data = json.loads(cleaned.replace("'", '"').replace('None', 'null'))
                    except:
                        raw_data = ast.literal_eval(cleaned)
                    
                    if isinstance(raw_data, list):
                        if not raw_data:
                            data = []
                        elif isinstance(raw_data[0], (tuple, list)):
                            data = []
                            for row in raw_data:
                                row_data = []
                                for cell in row:
                                    if cell is None:
                                        row_data.append('')
                                    elif isinstance(cell, (int, float)):
                                        row_data.append(str(cell))
                                    elif isinstance(cell, bytes):
                                        row_data.append(cell.decode('utf-8', errors='ignore'))
                                    else:
                                        row_data.append(str(cell))
                                data.append(row_data)
                        else:
                            data = [[str(item) if item is not None else ''] for item in raw_data]
                        
                        # If we have data but no columns, generate them
                        if data and not columns:
                            columns = [f'column_{i}' for i in range(len(data[0]))]
                        
                        output_data = {
                            "type": "select",
                            "data": data,
                            "columns": columns,
                            "row_count": len(data)
                        }
                    else:
                        raise ValueError("Unexpected data format")
                except Exception as e:
                    print(f"Error parsing SELECT result: {e}")
                    output_data = {
                        "type": "error",
                        "message": f"Failed to parse: {str(e)}"
                    }
            else:
                output_data = {
                    "type": "error",
                    "message": f"Unexpected format: {clean_result[:200]}"
                }
        
        else:
            # Handle INSERT, UPDATE, DELETE, CREATE, etc.
            clean_result = result.strip()
            affected_rows = 0
            
            if 'Query OK' in clean_result or 'rows affected' in clean_result:
                match = re.search(r'(\d+) rows? affected', clean_result)
                affected_rows = int(match.group(1)) if match else 0
                message = f"Statement executed successfully. {affected_rows} row(s) affected."
            else:
                message = clean_result or "Statement executed successfully."
            
            output_data = {
                "type": "status",
                "message": message,
                "affected_rows": affected_rows
            }
        
        final_result = f"SQL: `{sql_query}`\nOutput: {json.dumps(output_data)}"
        
        # Cache the result
        query_cache.set(question, db_uri, chat_history, final_result)
        
        return final_result
    
    except Exception as e:
        error_data = {
            "type": "error",
            "message": str(e)
        }
        sql_query_placeholder = sql_query if 'sql_query' in locals() else 'N/A'
        return f"SQL: `{sql_query_placeholder}`\nOutput: {json.dumps(error_data)}"

# ==================== API ENDPOINTS ====================

@app.post("/api/send-otp")
@limiter.limit("3/minute")  
async def send_otp_for_signup(
    request: Request,  
    otp_request: OtpRequest,  
    db: Session = Depends(get_db)
):
    """Send OTP - Now stored in database (Rate limited: 3 requests per minute)"""
    otp = generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    
    db.query(OTP).filter(OTP.email == otp_request.email).delete()
    
    db_otp = OTP(
        email=otp_request.email,  
        otp=otp,
        expires_at=expires_at
    )
    db.add(db_otp)
    db.commit()
    
    email_sent = send_otp_email(otp_request.email, otp)  
    
    if email_sent:
        message = "OTP has been sent to your email."
    else:
        message = "Email unavailable; check server logs for OTP."
    
    print(f"[OTP] Generated OTP for {otp_request.email}: {otp}")  
    return {"success": True, "message": message}

@app.post("/api/signup", status_code=201)
@limiter.limit("5/hour")  
async def signup_user(
    request: Request,  
    user: UserCreate, 
    db: Session = Depends(get_db)
):
    """Register new user - OTP verified from database (Rate limited: 5 signups per hour)"""
    stored_otp = db.query(OTP).filter(OTP.email == user.email).first()
    
    if not stored_otp:
        raise HTTPException(status_code=400, detail="OTP not requested or expired.")
    
    now = datetime.now(timezone.utc)
    expires_at = make_tz_aware(stored_otp.expires_at)
    
    if now > expires_at:
        db.delete(stored_otp)
        db.commit()
        raise HTTPException(status_code=400, detail="OTP has expired. Please request a new one.")
    
    if stored_otp.otp != user.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP provided.")
    
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    if user.phone:
        existing_phone = db.query(User).filter(User.phone == user.phone).first()
        if existing_phone:
            raise HTTPException(status_code=400, detail="Phone number already registered")
    
    existing_username = db.query(User).filter(User.username == user.username).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already taken")
    
    hashed_password = get_password_hash(user.password)
    db_user = User(
        email=user.email,
        phone=user.phone,
        firstName=user.firstName,
        lastName=user.lastName,
        gender=user.gender,
        username=user.username,
        hashed_password=hashed_password
    )
    db.add(db_user)
    
    db.delete(stored_otp)
    db.commit()
    db.refresh(db_user)
    
    return {"success": True, "message": "User created successfully"}

@app.post("/api/login")
@limiter.limit("10/minute")  
async def login_for_access_token(
    request: Request,  
    form_data: UserLogin, 
    db: Session = Depends(get_db)
):
    """Login with email or username (Rate limited: 10 attempts per minute)"""
    user = get_user(form_data.identifier, db)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email/username or password")
    
    return {
        "success": True,
        "message": "Login successful",
        "user": {
            "id": user.id,
            "email": user.email,
            "phone": user.phone,
            "firstName": user.firstName,
            "lastName": user.lastName,
            "username": user.username,
            "gender": user.gender
        }
    }

@app.post("/api/list-databases")
@limiter.limit("20/minute") 
async def list_databases(
    request: Request, 
    creds: DBCredentials
):
    """Step 1: Verify credentials and return list of available databases (Rate limited: 20 requests per minute)"""
    print(f"[LIST DB] Received request: host={creds.host}, port={creds.port}, user={creds.user}")
    
    try:
        # Connect to MySQL server without specifying database
        db_uri = f"mysql+mysqlconnector://{creds.user}:{quote_plus(creds.password)}@{creds.host}:{creds.port}"
        
        # Create temporary engine
        temp_engine = create_engine(
            db_uri,
            poolclass=pool.NullPool,  
            echo=False
        )
        
        # Test connection and get databases
        with temp_engine.connect() as conn:
            result = conn.execute(text("SHOW DATABASES"))
            databases = [row[0] for row in result]
            
            # Filter out system databases
            system_dbs = ['information_schema', 'mysql', 'performance_schema', 'sys']
            user_databases = [db for db in databases if db not in system_dbs]
        
        temp_engine.dispose()
        
        print(f"[LIST DB] Found {len(user_databases)} user databases")
        return {
            "success": True,
            "databases": user_databases,
            "message": f"Found {len(user_databases)} database(s)"
        }
    
    except OperationalError as e:
        error_msg = str(e)
        print(f"[LIST DB] OperationalError: {error_msg}")
        
        if "Access denied" in error_msg or "1045" in error_msg:
            raise HTTPException(
                status_code=401,
                detail={
                    "success": False,
                    "error": "Authentication Failed",
                    "message": "Invalid username or password for the MySQL server.",
                    "code": "AUTH_FAILED"
                }
            )
        elif "Can't connect" in error_msg or "Connection refused" in error_msg:
            raise HTTPException(
                status_code=503,
                detail={
                    "success": False,
                    "error": "Connection Refused",
                    "message": f"Cannot connect to MySQL server at {creds.host}:{creds.port}.",
                    "code": "CONNECTION_REFUSED"
                }
            )
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "success": False,
                    "error": "Connection Failed",
                    "message": error_msg,
                    "code": "CONNECTION_ERROR"
                }
            )
    
    except Exception as e:
        error_msg = str(e)
        print(f"[LIST DB] Unexpected error: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": "Unknown Error",
                "message": error_msg,
                "code": "UNKNOWN_ERROR"
            }
        )

@app.post("/api/create-database")
@limiter.limit("10/hour") 
async def create_database(
    request: Request,  
    config: DBCreate
):
    """Create a new database on the MySQL server (Rate limited: 10 creations per hour)"""
    print(f"[CREATE DB] Request to create database: {config.database_name}")
    
    try:
        # Validate database name (alphanumeric and underscores only)
        if not re.match(r'^[a-zA-Z0-9_]+$', config.database_name):
            raise HTTPException(
                status_code=400,
                detail={
                    "success": False,
                    "error": "Invalid Database Name",
                    "message": "Database name can only contain letters, numbers, and underscores.",
                    "code": "INVALID_NAME"
                }
            )
        
        # Check if database name is too long
        if len(config.database_name) > 64:
            raise HTTPException(
                status_code=400,
                detail={
                    "success": False,
                    "error": "Name Too Long",
                    "message": "Database name must be 64 characters or less.",
                    "code": "NAME_TOO_LONG"
                }
            )
        
        # Connect to MySQL server without specifying database
        db_uri = f"mysql+mysqlconnector://{config.user}:{quote_plus(config.password)}@{config.host}:{config.port}"
        
        # Create temporary engine
        temp_engine = create_engine(
            db_uri,
            poolclass=pool.NullPool,
            echo=False
        )
        
        # Create the database
        with temp_engine.connect() as conn:
            # Check if database already exists
            result = conn.execute(text("SHOW DATABASES"))
            existing_databases = [row[0] for row in result]
            
            if config.database_name in existing_databases:
                temp_engine.dispose()
                raise HTTPException(
                    status_code=409,
                    detail={
                        "success": False,
                        "error": "Database Already Exists",
                        "message": f"Database '{config.database_name}' already exists.",
                        "code": "DATABASE_EXISTS"
                    }
                )
            
            # Create the database
            conn.execute(text(f"CREATE DATABASE `{config.database_name}`"))
            conn.commit()
        
        temp_engine.dispose()
        
        print(f"[CREATE DB] Successfully created database: {config.database_name}")
        return {
            "success": True,
            "database_name": config.database_name,
            "message": f"Database '{config.database_name}' created successfully"
        }
    
    except HTTPException as e:
        raise e
    
    except OperationalError as e:
        error_msg = str(e)
        print(f"[CREATE DB] OperationalError: {error_msg}")
        
        if "Access denied" in error_msg or "1044" in error_msg:
            raise HTTPException(
                status_code=403,
                detail={
                    "success": False,
                    "error": "Permission Denied",
                    "message": "Your MySQL user does not have permission to create databases.",
                    "code": "PERMISSION_DENIED"
                }
            )
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "success": False,
                    "error": "Database Creation Failed",
                    "message": error_msg,
                    "code": "CREATION_ERROR"
                }
            )
    
    except Exception as e:
        error_msg = str(e)
        print(f"[CREATE DB] Unexpected error: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": "Unknown Error",
                "message": error_msg,
                "code": "UNKNOWN_ERROR"
            }
        )
    
@app.post("/api/connect")
@limiter.limit("20/minute") 
async def connect_db(
    request: Request,  
    config: DBSelection
):
    """Connect to MySQL database with connection pooling (Rate limited: 20 requests per minute)"""
    print(f"Received connect request: host={config.host}, port={config.port}, user={config.user}, database={config.database}")
    
    try:
        db_uri = f"mysql+mysqlconnector://{config.user}:{quote_plus(config.password)}@{config.host}:{config.port}/{config.database}"
        
        # ✅ Use connection pool manager
        test_engine = db_pool_manager.get_engine(db_uri)
        
        with test_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        
        # ✅ Get pooled SQLDatabase instance
        test_db = db_pool_manager.get_db(db_uri)
        
        # ✅ Pre-fetch and cache schema
        schema_cache.get_schema(db_uri, test_db)
        
        app.state.db_uri = db_uri
        app.state.db_name = config.database
        
        print("✅ Database connected with connection pooling and schema cached")
        return {"success": True, "message": "Database connected successfully"}
    
    except ProgrammingError as e:
        error_msg = str(e)
        print(f"ProgrammingError: {error_msg}")
        
        if "Unknown database" in error_msg or "1049" in error_msg:
            raise HTTPException(
                status_code=404,
                detail={
                    "success": False,
                    "error": "Database Not Found",
                    "message": f"The database '{config.database}' does not exist on the MySQL server.",
                    "suggestion": f"Please create the database first using: CREATE DATABASE `{config.database}`;",
                    "code": "DATABASE_NOT_FOUND"
                }
            )
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "success": False,
                    "error": "SQL Programming Error",
                    "message": error_msg,
                    "code": "SQL_ERROR"
                }
            )
    
    except OperationalError as e:
        error_msg = str(e)
        print(f"OperationalError: {error_msg}")
        
        if "Access denied" in error_msg or "1045" in error_msg:
            raise HTTPException(
                status_code=401,
                detail={
                    "success": False,
                    "error": "Authentication Failed",
                    "message": "Invalid username or password for the MySQL server.",
                    "suggestion": "Please verify your MySQL username and password.",
                    "code": "AUTH_FAILED"
                }
            )
        
        elif "Can't connect" in error_msg or "Connection refused" in error_msg or "2003" in error_msg:
            raise HTTPException(
                status_code=503,
                detail={
                    "success": False,
                    "error": "Connection Refused",
                    "message": f"Cannot connect to MySQL server at {config.host}:{config.port}.",
                    "suggestion": "Please verify the host and port are correct and the MySQL server is running.",
                    "code": "CONNECTION_REFUSED"
                }
            )
        
        elif "timeout" in error_msg.lower() or "2013" in error_msg or "Lost connection" in error_msg:
            raise HTTPException(
                status_code=504,
                detail={
                    "success": False,
                    "error": "Connection Timeout",
                    "message": "Connection to MySQL server timed out.",
                    "suggestion": "Please check your network connection and MySQL server status.",
                    "code": "CONNECTION_TIMEOUT"
                }
            )
        
        elif "host" in error_msg.lower() and ("unknown" in error_msg.lower() or "not found" in error_msg.lower()):
            raise HTTPException(
                status_code=404,
                detail={
                    "success": False,
                    "error": "Host Not Found",
                    "message": f"Cannot resolve hostname '{config.host}'.",
                    "suggestion": "Please verify the hostname or IP address is correct.",
                    "code": "HOST_NOT_FOUND"
                }
            )
        
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "success": False,
                    "error": "Connection Failed",
                    "message": error_msg,
                    "suggestion": "Please check your connection parameters and try again.",
                    "code": "CONNECTION_ERROR"
                }
            )
    
    except Exception as e:
        error_msg = str(e)
        print(f"Unexpected error: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": "Unknown Error",
                "message": error_msg,
                "suggestion": "An unexpected error occurred. Please check your configuration and try again.",
                "code": "UNKNOWN_ERROR"
            }
        )

@app.post("/api/disconnect")
async def disconnect_db():
    """Disconnect from database and clear caches"""
    if hasattr(app.state, "db_uri"):
        db_uri = app.state.db_uri
        
        # Clear connection pool
        db_pool_manager.clear_pool(db_uri)
        
        # Clear caches
        schema_cache.invalidate(db_uri)
        query_cache.clear()
        
        delattr(app.state, "db_uri")
        print("✅ Database disconnected, connection pool cleared, caches invalidated")
        return {"success": True, "message": "Database disconnected successfully"}
    return {"success": False, "message": "No database connection to disconnect"}

@app.post("/api/chat")
@limiter.limit("30/minute")  
async def chat_endpoint(
    request: Request, 
    chat_request: ChatRequest
):
    """✅ OPTIMIZED Chat endpoint with connection pooling and caching (Rate limited: 30 queries per minute)"""
    if not hasattr(app.state, "db_uri"):
        raise HTTPException(status_code=400, detail="Database not connected")
    
    chat_history = [
        AIMessage(content=msg["content"]) if msg["role"] == "ai"
        else HumanMessage(content=msg["content"])
        for msg in chat_request.chat_history  
    ]
    
    try:
        # ✅ Use pooled database connection
        db = db_pool_manager.get_db(app.state.db_uri)
        
        # ✅ Get cached schema
        cached_schema = schema_cache.get_schema(app.state.db_uri, db)
        
        # ✅ Get response with caching
        response = get_response(
            chat_request.question, 
            db, 
            chat_history, 
            app.state.db_uri,
            cached_schema
        )
        
        return {"success": True, "response": response}
    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@app.get("/api/chat-sessions")
@limiter.limit("60/minute") 
async def get_chat_sessions(
    request: Request, 
    user_id: int = Query(...)
):
    """Get all chat sessions for a specific user (Rate limited: 60 requests per minute)"""
    db_session = SessionLocal()
    try:
        sessions = db_session.query(ChatSession).filter(
            ChatSession.user_id == user_id
        ).order_by(ChatSession.id.desc()).all()
        
        result = []
        for session in sessions:
            result.append({
                "id": session.id,
                "user_id": session.user_id,
                "title": session.title,
                "messages": json.loads(session.messages),
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        
        print(f"[GET SESSIONS] Found {len(result)} sessions for user {user_id}")
        return result
    except Exception as e:
        print(f"[GET SESSIONS ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch chat sessions: {str(e)}")
    finally:
        db_session.close()

@app.post("/api/chat-sessions")
@limiter.limit("30/minute")  
async def create_chat_session(
    request: Request, 
    session: dict
):
    """Create a new chat session for a user (Rate limited: 30 creations per minute)"""
    db_session = SessionLocal()
    try:
        if not session.get("user_id"):
            raise HTTPException(status_code=400, detail="user_id is required")
        
        new_session = ChatSession(
            user_id=session.get("user_id"),
            title=session.get("title", "Untitled Chat"),
            messages=json.dumps(session.get("messages", []))
        )
        db_session.add(new_session)
        db_session.commit()
        db_session.refresh(new_session)
        
        print(f"[CREATE SESSION] Created session {new_session.id} for user {new_session.user_id}")
        
        return {
            "id": new_session.id,
            "user_id": new_session.user_id,
            "title": new_session.title,
            "messages": json.loads(new_session.messages),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        db_session.rollback()
        print(f"[CREATE SESSION ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create chat session: {str(e)}")
    finally:
        db_session.close()

@app.put("/api/chat-sessions/{session_id}")
@limiter.limit("60/minute")  
async def update_chat_session(
    request: Request, 
    session_id: int, 
    session: dict
):
    """Update a chat session (with user verification) (Rate limited: 60 updates per minute)"""
    db_session = SessionLocal()
    try:
        existing_session = db_session.query(ChatSession).filter(
            ChatSession.id == session_id
        ).first()
        
        if not existing_session:
            raise HTTPException(status_code=404, detail="Chat session not found")
        
        if existing_session.user_id != session.get("user_id"):
            print(f"[UPDATE SESSION] Unauthorized: Session {session_id} belongs to user {existing_session.user_id}, but user {session.get('user_id')} tried to access it")
            raise HTTPException(status_code=403, detail="Unauthorized to update this session")
        
        existing_session.title = session.get("title", existing_session.title)
        existing_session.messages = json.dumps(session.get("messages", json.loads(existing_session.messages)))
        db_session.commit()
        
        print(f"[UPDATE SESSION] Updated session {session_id} for user {existing_session.user_id}")
        
        return {
            "id": existing_session.id,
            "user_id": existing_session.user_id,
            "title": existing_session.title,
            "messages": json.loads(existing_session.messages),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        db_session.rollback()
        print(f"[UPDATE SESSION ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update chat session: {str(e)}")
    finally:
        db_session.close()

@app.delete("/api/chat-sessions/{session_id}")
@limiter.limit("30/minute") 
async def delete_chat_session(
    request: Request, 
    session_id: int, 
    user_id: int = Query(...)
):
    """Delete a chat session (with user verification) (Rate limited: 30 deletions per minute)"""
    db_session = SessionLocal()
    try:
        session = db_session.query(ChatSession).filter(
            ChatSession.id == session_id
        ).first()
        
        if not session:
            print(f"[DELETE SESSION] Session {session_id} not found, returning success (already deleted)")
            return {"success": True, "message": "Chat session not found or already deleted"}
        
        if session.user_id != user_id:
            print(f"[DELETE SESSION] Unauthorized: Session {session_id} belongs to user {session.user_id}, but user {user_id} tried to delete it")
            raise HTTPException(status_code=403, detail="Unauthorized to delete this session")
        
        db_session.delete(session)
        db_session.commit()
        
        print(f"[DELETE SESSION] Successfully deleted session {session_id} for user {user_id}")
        
        return {"success": True, "message": "Chat session deleted"}
    except HTTPException as e:
        raise e
    except Exception as e:
        db_session.rollback()
        print(f"[DELETE SESSION ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete chat session: {str(e)}")
    finally:
        db_session.close()

@app.post("/api/forgot-password")
@limiter.limit("3/minute")  
async def forgot_password(
    request: Request,  
    forgot_request: ForgotPasswordRequest,  
    db: Session = Depends(get_db)
):
    """Send OTP for password reset (Rate limited: 3 requests per minute)"""
    try:
        user = db.query(User).filter(User.email == forgot_request.email).first() 
        if not user:
            return {
                "success": True,
                "message": "If an account exists with this email, you will receive a password reset code."
            }
        
        otp = generate_otp()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        db.query(PasswordResetOTP).filter(PasswordResetOTP.email == forgot_request.email).delete()  
        
        db_otp = PasswordResetOTP(
            email=forgot_request.email, 
            otp=otp,
            expires_at=expires_at
        )
        db.add(db_otp)
        db.commit()
        
        email_sent = send_password_reset_email(forgot_request.email, otp) 
        
        if email_sent:
            message = "Password reset code has been sent to your email."
        else:
            message = "Email unavailable; check server logs for reset code."
        
        print(f"[PASSWORD RESET] Generated OTP for {forgot_request.email}: {otp}")  
        
        return {
            "success": True,
            "message": message
        }
    
    except Exception as e:
        print(f"[PASSWORD RESET ERROR] {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to process password reset request. Please try again."
        )

@app.post("/api/verify-reset-otp")
@limiter.limit("5/minute")  
async def verify_reset_otp(
    request: Request,  
    verify_request: dict, 
    db: Session = Depends(get_db)
):
    """Verify OTP for password reset (Rate limited: 5 attempts per minute)"""
    try:
        email = verify_request.get("email")  
        otp = verify_request.get("otp")  
        
        if not email or not otp:
            raise HTTPException(status_code=400, detail="Email and OTP are required")
        
        stored_otp = db.query(PasswordResetOTP).filter(
            PasswordResetOTP.email == email
        ).first()
        
        if not stored_otp:
            raise HTTPException(
                status_code=400,
                detail="Reset code not found or expired. Please request a new one."
            )
        
        now = datetime.now(timezone.utc)
        expires_at = make_tz_aware(stored_otp.expires_at)
        
        if now > expires_at:
            db.delete(stored_otp)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail="Reset code has expired. Please request a new one."
            )
        
        if stored_otp.otp != otp:
            raise HTTPException(status_code=400, detail="Invalid reset code.")
        
        return {
            "success": True,
            "message": "Reset code verified successfully."
        }
    
    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"[VERIFY OTP ERROR] {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to verify reset code. Please try again."
        )
@app.post("/api/reset-password")
@limiter.limit("5/minute") 
async def reset_password(
    request: Request, 
    reset_request: ResetPasswordRequest,  
    db: Session = Depends(get_db)
):
    """Reset password with OTP verification (Rate limited: 5 attempts per minute)"""
    try:
        stored_otp = db.query(PasswordResetOTP).filter(
            PasswordResetOTP.email == reset_request.email 
        ).first()
        
        if not stored_otp:
            raise HTTPException(
                status_code=400,
                detail="Reset code not found or expired."
            )
        
        now = datetime.now(timezone.utc)
        expires_at = make_tz_aware(stored_otp.expires_at)
        
        if now > expires_at:
            db.delete(stored_otp)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail="Reset code has expired."
            )
        
        if stored_otp.otp != reset_request.otp: 
            raise HTTPException(status_code=400, detail="Invalid reset code.")
        
        user = db.query(User).filter(User.email == reset_request.email).first()  # ✅ CHANGE
        if not user:
            raise HTTPException(status_code=404, detail="User not found.")
        
        if len(reset_request.new_password) < 8: 
            raise HTTPException(
                status_code=400,
                detail="Password must be at least 8 characters long."
            )
        
        user.hashed_password = get_password_hash(reset_request.new_password)  # ✅ CHANGE
        
        db.delete(stored_otp)
        
        db.commit()
        
        print(f"[PASSWORD RESET] Password reset successful for {reset_request.email}")  # ✅ CHANGE
        
        return {
            "success": True,
            "message": "Password has been reset successfully. You can now login with your new password."
        }
    
    except HTTPException as e:
        raise e
    except Exception as e:
        db.rollback()
        print(f"[RESET PASSWORD ERROR] {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to reset password. Please try again."
        )


@app.post("/api/resend-reset-otp")
@limiter.limit("3/minute")  
async def resend_reset_otp(
    request: Request, 
    resend_request: ForgotPasswordRequest,  
    db: Session = Depends(get_db)
):
    """Resend OTP for password reset (Rate limited: 3 requests per minute)"""
    try:
        user = db.query(User).filter(User.email == resend_request.email).first()  
        if not user:
            return {
                "success": True,
                "message": "If an account exists with this email, you will receive a new reset code."
            }
        
        existing_otp = db.query(PasswordResetOTP).filter(
            PasswordResetOTP.email == resend_request.email  
        ).first()
        
        if existing_otp:
            created_at = make_tz_aware(existing_otp.created_at)
            time_since_last = datetime.now(timezone.utc) - created_at
            
            if time_since_last < timedelta(minutes=1):
                wait_seconds = 60 - time_since_last.seconds
                return {
                    "success": False,
                    "message": f"Please wait {wait_seconds} seconds before requesting a new code."
                }
        
        otp = generate_otp()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        db.query(PasswordResetOTP).filter(
            PasswordResetOTP.email == resend_request.email  
        ).delete()
        
        db_otp = PasswordResetOTP(
            email=resend_request.email,  
            otp=otp,
            expires_at=expires_at
        )
        db.add(db_otp)
        db.commit()
        
        email_sent = send_password_reset_email(resend_request.email, otp) 
        
        print(f"[RESEND OTP] New OTP for {resend_request.email}: {otp}") 
        
        return {
            "success": True,
            "message": "A new reset code has been sent to your email."
        }
    
    except Exception as e:
        print(f"[RESEND OTP ERROR] {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to resend reset code. Please try again."
        )

@app.post("/api/send-email-change-otp")
@limiter.limit("3/minute")
async def send_email_change_otp_endpoint(
    request: Request,
    otp_request: SendEmailOTPRequest,
    db: Session = Depends(get_db)
):
    """Send OTP to verify email change"""
    try:
        user = db.query(User).filter(User.id == otp_request.userId).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check if new email already exists
        existing = db.query(User).filter(
            User.email == otp_request.newEmail,
            User.id != otp_request.userId
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        
        # Generate and store OTP
        otp = generate_otp()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
        
        # Delete old OTP if exists
        db.query(ProfileUpdateOTP).filter(ProfileUpdateOTP.user_id == otp_request.userId).delete()
        
        # Save new OTP
        db_otp = ProfileUpdateOTP(
            user_id=otp_request.userId,
            otp=otp,
            new_email=otp_request.newEmail,
            expires_at=expires_at
        )
        db.add(db_otp)
        db.commit()
        
        # Send email
        user_name = f"{user.firstName} {user.lastName}"
        send_email_change_otp(otp_request.newEmail, otp, user_name)
        
        print(f"[EMAIL CHANGE OTP] Generated for user {user.id}: {otp}")
        return {"success": True, "message": f"OTP sent to {otp_request.newEmail}"}
    
    except HTTPException as e:
        raise e
    except Exception as e:
        print(f"[EMAIL CHANGE OTP ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to send OTP")

@app.put("/api/update-email")
@limiter.limit("10/minute")
async def update_email_with_otp(
    request: Request,
    email_request: UpdateEmailRequest,
    db: Session = Depends(get_db)
):
    """Update email after OTP verification"""
    try:
        user = db.query(User).filter(User.id == email_request.userId).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get OTP record
        otp_record = db.query(ProfileUpdateOTP).filter(
            ProfileUpdateOTP.user_id == email_request.userId
        ).first()
        
        if not otp_record:
            raise HTTPException(status_code=400, detail="OTP not found or expired")
        
        # Check expiration
        now = datetime.now(timezone.utc)
        expires_at = make_tz_aware(otp_record.expires_at)
        if now > expires_at:
            db.delete(otp_record)
            db.commit()
            raise HTTPException(status_code=400, detail="OTP expired")
        
        # Verify OTP
        if otp_record.otp != email_request.otp:
            raise HTTPException(status_code=400, detail="Invalid OTP")
        
        # Verify email matches
        if otp_record.new_email != email_request.newEmail:
            raise HTTPException(status_code=400, detail="Email mismatch")
        
        # Update email
        user.email = email_request.newEmail
        db.delete(otp_record)
        db.commit()
        db.refresh(user)
        
        print(f"[EMAIL UPDATE] Email updated for user {user.id}")
        
        return {
            "success": True,
            "message": "Email updated successfully",
            "user": {
                "id": user.id,
                "email": user.email,
                "firstName": user.firstName,
                "lastName": user.lastName,
                "username": user.username,
                "phone": user.phone,
                "gender": user.gender
            }
        }
    
    except HTTPException as e:
        raise e
    except Exception as e:
        db.rollback()
        print(f"[EMAIL UPDATE ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to update email")
    

@app.put("/api/update-profile")
@limiter.limit("10/minute")
async def update_profile(
    request: Request,
    profile_request: UpdateProfileRequest,
    db: Session = Depends(get_db)
):
    """Update user profile (Rate limited: 10 updates per minute)"""
    try:
        # Get the user
        user = db.query(User).filter(User.id == profile_request.userId).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check if email is being changed and if it's already taken
        if profile_request.email != user.email:
            existing_email = db.query(User).filter(
                User.email == profile_request.email,
                User.id != profile_request.userId
            ).first()
            if existing_email:
                raise HTTPException(status_code=400, detail="Email already in use")
        
        # Check if username is being changed and if it's already taken
        if profile_request.username != user.username:
            existing_username = db.query(User).filter(
                User.username == profile_request.username,
                User.id != profile_request.userId
            ).first()
            if existing_username:
                raise HTTPException(status_code=400, detail="Username already taken")
        
        # Check if phone is being changed and if it's already taken
        if profile_request.phone != user.phone:
            existing_phone = db.query(User).filter(
                User.phone == profile_request.phone,
                User.id != profile_request.userId
            ).first()
            if existing_phone:
                raise HTTPException(status_code=400, detail="Phone number already registered")
        
        # Update user fields
        user.firstName = profile_request.firstName
        user.lastName = profile_request.lastName
        user.username = profile_request.username
        user.email = profile_request.email
        user.phone = profile_request.phone
        user.gender = profile_request.gender
        
        db.commit()
        db.refresh(user)
        
        print(f"[UPDATE PROFILE] Profile updated for user {user.id}")
        
        return {
            "success": True,
            "message": "Profile updated successfully",
            "user": {
                "id": user.id,
                "firstName": user.firstName,
                "lastName": user.lastName,
                "username": user.username,
                "email": user.email,
                "phone": user.phone,
                "gender": user.gender
            }
        }
    
    except HTTPException as e:
        raise e
    except Exception as e:
        db.rollback()
        print(f"[UPDATE PROFILE ERROR] {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to update profile. Please try again."
        )
@app.post("/api/change-password")
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    password_request: ChangePasswordRequest,
    db: Session = Depends(get_db)
):
    """Change user password (Rate limited: 5 attempts per minute)"""
    try:
        # Get the user
        user = db.query(User).filter(User.id == password_request.userId).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Verify current password
        if not verify_password(password_request.currentPassword, user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        
        # Validate new password length
        if len(password_request.newPassword) < 8:
            raise HTTPException(
                status_code=400,
                detail="New password must be at least 8 characters long"
            )
        
        # Check if new password is different from current
        if verify_password(password_request.newPassword, user.hashed_password):
            raise HTTPException(
                status_code=400,
                detail="New password must be different from current password"
            )
        
        # Update password
        user.hashed_password = get_password_hash(password_request.newPassword)
        
        db.commit()
        
        print(f"[CHANGE PASSWORD] Password changed successfully for user {user.id}")
        
        return {
            "success": True,
            "message": "Password changed successfully"
        }
    
    except HTTPException as e:
        raise e
    except Exception as e:
        db.rollback()
        print(f"[CHANGE PASSWORD ERROR] {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to change password. Please try again."
        )
    
@app.post("/api/confirm-sql")
@limiter.limit("20/minute") 
async def confirm_sql_action(
    request: Request, 
    req: ConfirmSQLRequest
):
    """Confirm and execute dangerous SQL (Rate limited: 20 confirmations per minute)"""
    if not req.confirm:
        return {
            "type": "status",
            "message": "SQL execution cancelled by user"
        }
    
    try:
        if not hasattr(app.state, "db_uri"):
            raise HTTPException(status_code=400, detail="Database not connected")

        db = db_pool_manager.get_db(app.state.db_uri)
        result = db.run(req.sql)
        
        schema_cache.invalidate(app.state.db_uri)
        query_cache.clear()
        
        return {
            "type": "status",
            "message": f"SQL executed successfully. Result: {result}"
        }
    except Exception as e:
        return {
            "type": "error",
            "message": str(e)
        }

@app.get("/api/cache-stats")
async def get_cache_stats():
    """Get cache statistics for debugging"""
    return {
        "schema_cache_size": len(schema_cache._cache),
        "query_cache_size": len(query_cache._cache),
        "connection_pools": len(db_pool_manager._pools)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)