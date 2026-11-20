import { Routes, Route } from 'react-router'
import Home, { DEFAULT_SCENE_URL } from './pages/Home'

const params = new URLSearchParams(window.location.search)
const nav = params.get('nav')
const framing = (() => { try { return JSON.parse(params.get('framing') ?? 'null') ?? undefined } catch { return undefined } })()

export default function App() {
  return (
    <Routes>
      {/* Para probar modelos concretos: ?src=<url>&nav=interior|look&framing=<json del encuadre>&ui=0 (sin paneles). */}
      <Route path="/" element={<Home showUI={params.get('ui') !== '0'} src={params.get('src') ?? DEFAULT_SCENE_URL} initialNavigation={nav === 'look' || nav === 'interior' ? nav : 'orbit'} framing={framing} />} />
    </Routes>
  )
}
