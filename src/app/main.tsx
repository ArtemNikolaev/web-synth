import { createRoot } from 'react-dom/client'
import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { RackPage } from '../pages/rack/index.ts'

createRoot(document.getElementById('root')!).render(<ReactFlowProvider><RackPage /></ReactFlowProvider>)
