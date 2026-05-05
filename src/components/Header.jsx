import React, { useState } from 'react';
import { Zap, X, Send, AlertCircle, Sun, Moon, Github, ExternalLink } from 'lucide-react';

const Header = ({ theme, toggleTheme }) => {
  const [activeModal, setActiveModal] = useState(null);
  const closeModal = () => setActiveModal(null);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) closeModal();
  };

  return (
    <>
      <header className="header">
        <div className="container header-content">
          <div className="logo">
            <Zap className="logo-icon" size={24} color="#f59e0b" fill="#f59e0b" />
            <span>СвітлоUA</span>
          </div>

          <div className="nav-wrapper">
            <nav className="nav">
              {/*Кнопка Про проєкт*/}
              <button 
                className="nav-link btn-link" 
                onClick={() => setActiveModal('github')}
              >
                Про проєкт
              </button>

              {/*Кнопка Контакти*/}
              <button 
                className="nav-link btn-link" 
                onClick={() => setActiveModal('contacts')}
              >
                Контакти
              </button>

              {/*Кнопка Підтримка*/}
              <button 
                className="nav-link btn-link" 
                onClick={() => setActiveModal('support')}
              >
                Підтримка
              </button>
            </nav>

            {/*Зміна теми*/}
            <button 
              className="theme-btn" 
              onClick={toggleTheme}
              title={theme === 'light' ? "Увімкнути темну тему" : "Увімкнути світлу тему"}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} color="#f59e0b" />}
            </button>
          </div>
        </div>
      </header>

      {/*Модалки*/}
      {activeModal && (
        <div className="modal-overlay" onClick={handleOverlayClick}>
          <div className="modal-content">
            <button className="close-btn" onClick={closeModal}>
              <X size={20} />
            </button>

            {/*Про проект*/}
            {activeModal === 'github' && (
              <div className="modal-body centered">
                <div className="icon-wrapper">
                  <Github size={40} color="#3b82f6" />
                </div>
                <h3>Перехід на GitHub</h3>
                <p className="modal-desc">
                  Ви переходите на сторінку з вихідним кодом проєкту. Бажаєте продовжити?
                </p>
                <div className="modal-actions">
                  <button className="btn-secondary" onClick={closeModal}>
                    Скасувати
                  </button>
                  <a 
                    href="https://github.com/Nadlaf/LightUA"
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="btn-primary"
                    onClick={closeModal}
                  >
                    Перейти <ExternalLink size={16} style={{marginLeft: 6}}/>
                  </a>
                </div>
              </div>
            )}

            {/*Контакти*/}
            {activeModal === 'contacts' && (
              <div className="modal-body">
                <h3>Зв'язок з розробниками</h3>
                <p className="modal-desc">Маєте пропозиції чи знайшли помилку? Пишіть нам:</p>
                
                <div className="contact-list">
                  <a href="https://t.me/faldanchik" target="_blank" rel="noreferrer" className="contact-item">
                    <Send size={18} /> @faldanchik
                  </a>
                  <a href="https://t.me/NeToR_1" target="_blank" rel="noreferrer" className="contact-item">
                    <Send size={18} /> @NeToR_1
                  </a>
                </div>
              </div>
            )}

            {/*Підтримка*/}
            {activeModal === 'support' && (
              <div className="modal-body centered">
                <div className="icon-wrapper">
                  <AlertCircle size={40} color="#3b82f6" />
                </div>
                <h3>Функція в розробці</h3>
                <button className="btn-primary" onClick={closeModal}>Зрозуміло</button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .header {
          background-color: var(--bg-card);
          padding: 15px 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          position: sticky;
          top: 0;
          z-index: 100;
          transition: background 0.3s;
        }

        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .nav-wrapper { display: flex; align-items: center; gap: 20px; }

        .logo {
          display: flex; align-items: center; gap: 8px;
          font-weight: 700; font-size: 1.25rem;
          color: var(--text-main);
        }
        .logo-icon { transform: rotate(-10deg); }

        .nav { display: flex; gap: 20px; align-items: center; }

        .nav-link {
          text-decoration: none;
          color: var(--text-main);
          font-size: 0.95rem; font-weight: 500;
          background: none; border: none; cursor: pointer;
          transition: color 0.2s;
          padding: 0;
          font-family: inherit;
        }
        .nav-link:hover { color: var(--primary); }

        .theme-btn {
          width: 40px; height: 40px;
          border-radius: 50%;
          border: 1px solid var(--border);
          background: var(--bg-element);
          color: var(--text-main);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s;
        }
        .theme-btn:hover { border-color: var(--primary); transform: scale(1.05); }

        /* Modals */
        .modal-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px);
          z-index: 1000; display: flex; align-items: center; justify-content: center;
          animation: fadeIn 0.2s ease-out;
        }
        .modal-content {
          background: var(--bg-card);
          color: var(--text-main);
          padding: 30px; border-radius: 20px; width: 90%; max-width: 400px;
          position: relative; box-shadow: var(--shadow);
          animation: scaleUp 0.2s ease-out;
        }
        .close-btn {
          position: absolute; top: 15px; right: 15px;
          background: none; border: none; color: var(--text-secondary); cursor: pointer;
        }
        .close-btn:hover { color: var(--text-main); }

        .modal-body h3 { font-size: 1.25rem; margin-bottom: 10px; font-weight: 700; }
        .modal-desc { color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5; }

        /* Контакти */
        .contact-list { display: flex; flex-direction: column; gap: 10px; }
        .contact-item {
          display: flex; align-items: center; gap: 10px; padding: 12px;
          background: var(--bg-element);
          border-radius: 12px; text-decoration: none;
          color: var(--text-main); font-weight: 500; transition: background 0.2s;
        }
        .contact-item:hover { background: var(--bg-element-hover); color: var(--primary); }
        
        /* Centered Modal (Support & GitHub) */
        .centered { text-align: center; display: flex; flex-direction: column; align-items: center; }
        .icon-wrapper { 
          width: 60px; height: 60px; 
          background: var(--bg-element); 
          border-radius: 50%; 
          display: flex; align-items: center; justify-content: center; 
          margin-bottom: 15px; 
        }

        /* Buttons Action Group */
        .modal-actions {
          display: flex;
          gap: 15px;
          width: 100%;
          justify-content: center;
        }

        .btn-primary {
          background: var(--primary); color: white;
          border: none; padding: 10px 24px; border-radius: 10px;
          font-weight: 600; cursor: pointer; 
          transition: background 0.2s;
          text-decoration: none;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .btn-primary:hover { background: var(--primary-hover); }

        .btn-secondary {
          background: transparent; 
          color: var(--text-secondary);
          border: 1px solid var(--border); 
          padding: 10px 24px; border-radius: 10px;
          font-weight: 600; cursor: pointer; 
          transition: all 0.2s;
        }
        .btn-secondary:hover { 
          border-color: var(--text-main);
          color: var(--text-main); 
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleUp { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        @media (max-width: 768px) { .nav { display: none; } }
      `}</style>
    </>
  );
};

export default Header;