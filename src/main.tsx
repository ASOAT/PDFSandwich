import React from 'react';
import './note-flush';
import { createRoot } from 'react-dom/client';
import 'pdfjs-dist/web/pdf_viewer.css';
import App from './App';
import { NotesPanel } from './NotesPanel';
import { applyAppearance } from './ResearchSettings';

import './style.css';
import './themes.css';
import './research.css';
import './palettes.css';
applyAppearance();
const noteId=new URLSearchParams(location.search).get('note');
createRoot(document.getElementById('root')!).render(noteId?<NotesPanel noteId={noteId} popout/>:<App/>);
