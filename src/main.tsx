import React from 'react';
import { createRoot } from 'react-dom/client';
import 'pdfjs-dist/web/pdf_viewer.css';
import App from './App';
import './style.css';
import './themes.css';
createRoot(document.getElementById('root')!).render(<App/>);
