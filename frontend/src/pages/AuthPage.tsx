import { useState } from 'react';
import AuthLayout from '@/components/auth/AuthLayout';
import LoginForm from '@/components/auth/LoginForm';
import SignupForm from '@/components/auth/SignupForm';

const AuthPage = () => {
  const [isSignup, setIsSignup] = useState(false);

  return (
    <AuthLayout 
      title={isSignup ? 'Create Account' : 'Welcome Back'}
      subtitle={isSignup 
        ? 'Join Query Genie and unlock AI-powered database interactions' 
        : 'Sign in to continue your database journey'
      }
    >
      {isSignup ? (
        <SignupForm onSwitchToLogin={() => setIsSignup(false)} />
      ) : (
        <LoginForm onSwitchToSignup={() => setIsSignup(true)} />
      )}
    </AuthLayout>
  );
};

export default AuthPage;