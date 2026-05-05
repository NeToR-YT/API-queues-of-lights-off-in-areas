import React, { useState, useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import Header from './components/Header';
import ScheduleForm from './components/ScheduleForm';
import ScheduleResult from './components/ScheduleResult';
import Footer from './components/Footer';
import { fetchSchedule } from './api/scheduleService';

function App() {
    const [scheduleData, setScheduleData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

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

    const handleSearch = async (formData) => {
        setIsLoading(true);
        setScheduleData(null);

        try {
            const data = await fetchSchedule(formData);
            setScheduleData(data);
        } catch (error) {
            console.error("Помилка:", error);
            alert("Не вдалося завантажити графік для обраної дати.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="app-wrapper">
            <Header theme={theme} toggleTheme={toggleTheme} />

            <main className="container wide-container main-content">

                {scheduleData && scheduleData.emergencyOutages && (
                    <div className="emergency-banner">
                        <div className="banner-icon">
                            <TriangleAlert size={18} />
                        </div>
                        <span className="banner-text">
                            Наразі працюють аварійні відключення. Графіки можуть бути неточними.
                         </span>
                    </div>
                )}

                <div className="grid-layout">
                    <div className="left-panel">
                        <ScheduleForm onSearch={handleSearch} />
                    </div>

                    <div className="right-panel">
                        {isLoading ? (
                            <div className="loading-state">
                                <div className="spinner"></div>
                            </div>
                        ) : (
                            <ScheduleResult scheduleData={scheduleData} />
                        )}
                    </div>
                </div>
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

        .emergency-banner {
          height: 44px;
          background-color: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 12px;
          padding: 0 16px;
          
          display: flex;
          align-items: center;
          gap: 12px;
          
          margin-bottom: 30px; 
          color: #991b1b;
          box-shadow: 0 2px 10px rgba(239, 68, 68, 0.05);
          animation: slideDown 0.3s ease-out;
          box-sizing: border-box;
        }

        [data-theme="dark"] .emergency-banner {
          background-color: #450a0a;
          border-color: #7f1d1d;
          color: #fca5a5;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }

        .banner-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          color: inherit; 
        }

        .banner-text {
          font-size: 0.95rem;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .grid-layout {
          display: grid;
          grid-template-columns: 400px minmax(0, 1fr); 
          gap: 40px;
          align-items: start;
        }

        .right-panel { width: 100%; position: relative; }
        
        .loading-state {
          width: 100%; 
          min-height: 600px;
          height: 100%;
          background: var(--bg-card); 
          border-radius: 24px;
          box-shadow: var(--shadow);  
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          transition: background 0.3s;
        }

        .spinner {
          width: 70px;
          height: 70px;
          border: 5px solid var(--bg-element); 
          border-top: 5px solid var(--primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 1100px) {
          .grid-layout {
             grid-template-columns: 350px minmax(0, 1fr);
             gap: 30px;
          }
        }

        @media (max-width: 900px) {
          .grid-layout { grid-template-columns: 1fr; }
          .wide-container { max-width: 100% !important; }
          
          /* Адаптивність банера для мобільних */
          .emergency-banner {
            height: auto;
            min-height: 44px;
            padding: 10px 16px;
          }
          .banner-text {
            white-space: normal;
          }
        }
      `}
        </style>
      </div>
    );
}

export default App;