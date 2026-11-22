import Home from './pages/Home'

const params = new URLSearchParams(window.location.search)
const nav = params.get('nav')
const framing = (() => { try { return JSON.parse(params.get('framing') ?? 'null') ?? undefined } catch { return undefined } })()

export default function App() {
  // Para probar modelos concretos: ?src=<url>&nav=interior|look&framing=<json del encuadre>&ui=0 (sin paneles).
  return <Home showUI={params.get('ui') !== '0'} src={params.get('src') ?? undefined} initialNavigation={nav === 'look' || nav === 'interior' ? nav : 'orbit'} framing={framing} />
}
