# Query Genie 🧞

Query Genie is an AI-powered application that allows users to interact with relational databases using **natural language instead of writing SQL manually**.  
It converts plain English questions into executable SQL queries and returns structured results in real time.

> Example:  
> **“Show the top 5 customers by total purchase amount”**  
> → Automatically translated into SQL and executed on the connected database.

-----

## 🌐 Live Demo

🔗 **Deployed Application:**  
https://your-deployment-link-here

> ⚠️ Note: Use test database credentials only.  
> Do not connect production databases.

-----

## 🚀 Features

- 🔐 Secure user authentication with OTP-based email verification  
- 💬 Natural Language → SQL query generation using AI  
- 🧠 Context-aware SQL generation using live database schema  
- 📊 Interactive tabular visualization of query results  
- 💾 Persistent chat and query history  
- 🔄 Dynamic database connection using user-provided credentials  
- ⚠️ Detection and warning for dangerous SQL operations (DROP, DELETE, UPDATE)

-----

## 🧠 How Query Genie Works

1. User submits a natural language query from the frontend  
2. Backend fetches the connected database schema  
3. LangChain constructs a structured prompt with schema and user intent  
4. Groq LLM generates the corresponding SQL query  
5. Query is analyzed for potentially destructive operations  
6. Safe queries are executed on the database  
7. Results are returned and rendered in the UI  

-----

## 🛠️ Tech Stack

### Frontend
- React + TypeScript
- Vite
- Tailwind CSS
- Lucide Icons

### Backend
- FastAPI
- LangChain
- Groq LLM
- SQLAlchemy ORM
- MySQL Connector
- Passlib (bcrypt)

### DevOps
- Docker
- Docker Compose
- Nginx

-----

## 📋 Prerequisites

- Python 3.8 or higher  
- Node.js 16 or higher  
- MySQL Server  
- Groq API Key  
- Docker (v20+)  //optional
- Docker Compose (v2+)  //optional 
-----

## 📦 Installation & Setup

### Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/query-genie.git
cd query-genie

### 1.🐳 Docker Setup (Recommended)
This is the recommended and easiest way to run Query Genie.
Docker runs frontend, backend, and database automatically.

▶️ Run the Application (Docker)
From the project root:

# Build all services
docker-compose build

# Start all services
docker-compose up

# Run in background
docker-compose up -d

🛑 Stop Containers
docker-compose down

Delete database data (⚠️ irreversible):
docker-compose down -v

If you are using Docker, skip manual backend and frontend setup,
but do not forget to create the backend/.env file.

🔐 Environment Variables
Create a .env file inside the backend directory:

# Groq API
GROQ_API_KEY=your_groq_api_key_here

# Email (OTP)
EMAIL_HOST_USER=your_email@gmail.com
EMAIL_HOST_PASSWORD=your_gmail_app_password

#Getting API Keys
Groq API Key
Visit Groq Console
Sign up for a free account
Generate an API key from the dashboard

#Gmail App Password
Enable 2-factor authentication on your Google account
Go to App Passwords
Generate a new app password for "Mail"
Use this password in your .env file

### 2. Backend Setup
```bash
cd query-genie/backend

# Create virtual environment
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install all dependencies in one command!
pip install -r requirements.txt

### 3. Frontend Setup
Navigate to frontend directory (if separate)
```bash
cd query-genie/frontend

Install dependencies
npm install
```

-----

## Running the Application

###  Start Backend
```bash
cd backend
python -m uvicorn backend:app --reload --host 0.0.0.0 --port 8000


### Start Frontend
```bash
cd frontend
npm run dev
```

Access the application at `http://localhost:5173`

## Configuration

### Database Connection
1. Login to the application
2. Navigate to Database Settings
3. Enter your MySQL credentials:
   - Host
   - Port
   - Username
   - Password
   - Select database or create new database

## Project Structure
```
query-genie/
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── backend.py
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── nginx.conf
│   ├── package.json
│   └── src/
├── docker-compose.yml
└── README.md
```

🔐 Security Notes :- 
* **Password Hashing** – Passwords stored as bcrypt hashes
* **OTP Verification** – Email-based one-time password for signup
* **SQL Injection Protection** – Parameterized queries using SQLAlchemy
* **Destructive Operation Warnings** – Confirmation required for DELETE, DROP, UPDATE
* **Connection Pooling** – Efficient reuse of database connections
* **Input Validation** – Request validation using Pydantic models

Acknowledgments
- FastAPI – Modern Python web framework
- LangChain – Framework for building LLM applications
- Groq – High-performance LLM inference engine
- React – Frontend JavaScript framework
- Tailwind CSS – Utility-first CSS framework
- shadcn/ui – Prebuilt, accessible UI components

⚠️ This project is intended for educational and experimental use.
Additional security hardening is required for production environments.

🤝 Contributing
Contributions, issues, and feature requests are welcome.
Fork the repository
Create a new branch
Commit your changes
Open a Pull Request

📄 License
This project is licensed under the MIT License.

👤 Author
Raj Rajkumar Yadav
GitHub: https://github.com/Rajyadav999
Linkedin: www.linkedin.com/in/raj-yadav-706b60397
