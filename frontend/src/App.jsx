import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import StatsPage from './pages/StatsPage';

function App() {
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('app-theme') || 'light';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('app-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    return (
        <div className="app-wrapper">
            <Header theme={theme} toggleTheme={toggleTheme} />

            <main className="container wide-container main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/stats" element={<StatsPage theme={theme} />} />
          </Routes>
            </main>

            <Footer />

            <style>{`
        .app-wrapper {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .wide-container { max-width: 1440px !important; }

        .main-content {
          padding-top: 40px;
          padding-bottom: 60px;
          flex: 1;
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 900px) {
          .wide-container { max-width: 100% !important; }
        }
      `}
        </style>
      </div>
    );
}

export default App;