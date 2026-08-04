import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { BoardPreview } from './pages/BoardPreview.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/5-players" element={<BoardPreview playerCount={5} />} />
        <Route path="/6-players" element={<BoardPreview playerCount={6} />} />
        <Route path="/7-players" element={<BoardPreview playerCount={7} />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
