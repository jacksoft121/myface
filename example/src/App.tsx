import React, { useState } from 'react';
import LoginScreen from './LoginScreen';
import ArcSoftInfoScreen from './ArcSoftInfoScreen';

export default function App() {
  const [isLoggedIn, setLoggedIn] = useState(false);

  const handleLoginSuccess = () => {
    setLoggedIn(true);
  };

  if (!isLoggedIn) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return <ArcSoftInfoScreen />;
}
