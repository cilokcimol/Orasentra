// The memory core: an ice core sample where every band is a real memory stored on Walrus.
// Newest on top. Colour tells the room it came from. Writing a memory drops a new band in.

import * as THREE from 'three'
import { bus, prefersReducedMotion, esc, ago, ROOM_LABEL } from './lib'

export interface CoreBand {
  room: string
  kind?: string
  at: number
  text?: string
  url?: string
  status?: string
}

const ROOM_COLOR: Record<string, number> = { calls: 0xe0893a, watch: 0xc8483f, pocket: 0x3f8f70, ledger: 0x8cc5d6 }
const ICE = [0xcfe4ea, 0xb9d6de, 0xdcebef, 0xa9cbd4, 0xe6f1f3]

export interface CoreHandle {
  setBands(b: CoreBand[]): void
  destroy(): void
}

function webglOk() {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

function fallback(host: HTMLElement): CoreHandle {
  host.classList.add('core-fallback')
  const render = (bands: CoreBand[]) => {
    host.innerHTML = `<div class="flat-core" aria-hidden="true">${bands
      .slice(0, 28)
      .map(b => `<i style="--c:#${(ROOM_COLOR[b.room] ?? ICE[0]).toString(16).padStart(6, '0')}"></i>`)
      .join('')}</div>`
  }
  return { setBands: render, destroy: () => (host.innerHTML = '') }
}

export function mountCore(host: HTMLElement, opts: { tall?: boolean; tooltip?: HTMLElement } = {}): CoreHandle {
  if (!webglOk()) return fallback(host)
  const reduced = prefersReducedMotion()
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  host.append(renderer.domElement)
  renderer.domElement.setAttribute('aria-hidden', 'true')

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  const target = new THREE.Vector3(0, 0.4, 0)

  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x0d2b33, 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(4, 6, 5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x8cc5d6, 2.4)
  rim.position.set(-5, 2, -4)
  scene.add(rim)

  const group = new THREE.Group()
  group.rotation.z = -0.1
  group.scale.set(1.45, 1, 1.45)
  scene.add(group)

  // Layers
  const MAX = 64
  const H = 6.4
  const layerGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1)
  const layerMat = new THREE.MeshPhysicalMaterial({ roughness: 0.28, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35, transparent: true, opacity: 0.9, sheen: 0.4, sheenColor: new THREE.Color(0xbfe3ee) })
  const layers = new THREE.InstancedMesh(layerGeo, layerMat, MAX)
  layers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  group.add(layers)

  // Glass sleeve with a fresnel edge, so the core reads as ice in a tube.
  const sleeveMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0xbfe3ee) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 2.4); gl_FragColor = vec4(uColor, 0.05 + f*0.55); }`,
  })
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(1.09, 1.09, H + 0.5, 72, 1, true), sleeveMat)
  group.add(sleeve)

  // Trapped bubbles
  const N = reduced ? 120 : 340
  const pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    const r = Math.sqrt(Math.random()) * 0.96
    const a = Math.random() * Math.PI * 2
    pos.set([Math.cos(a) * r, (Math.random() - 0.5) * H, Math.sin(a) * r], i * 3)
  }
  const bubbleGeo = new THREE.BufferGeometry()
  bubbleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.025, transparent: true, opacity: 0.7, depthWrite: false }))
  group.add(bubbles)

  // Tide ring: the one motion that marks a new memory.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: 0x8cc5d6, transparent: true, opacity: 0 }))
  ring.rotation.x = Math.PI / 2
  group.add(ring)

  // Floating sample labels for the newest memories, projected from 3D.
  const labelHost = document.createElement('div')
  labelHost.className = 'core-labels'
  host.append(labelHost)
  let bands: CoreBand[] = []
  type Slot = { y: number; h: number; band?: CoreBand; color: THREE.Color; drop: number; r: number }
  let slots: Slot[] = []
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()

  function layout(drop = -1) {
    const mem = bands.slice(0, 40)
    const count = Math.min(MAX, Math.max(28, mem.length + 12))
    const list: Slot[] = []
    let rng = 7
    const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < count; i++) {
      const band = mem[i]
      const h = band ? 0.08 + (band.kind === 'scorecard' || band.kind === 'rule' ? 0.07 : 0.03) : 0.06 + rand() * 0.16
      const color = new THREE.Color(band ? ROOM_COLOR[band.room] ?? ICE[0] : ICE[Math.floor(rand() * ICE.length)])
      if (band && band.status === 'pending') color.lerp(new THREE.Color(0xffffff), 0.45)
      list.push({ y: 0, h, band, color, drop: i === drop ? 1 : 0, r: band ? 1.015 : 0.95 + rand() * 0.05 })
    }
    const total = list.reduce((a, l) => a + l.h + 0.012, 0)
    const scale = H / total
    let y = H / 2
    for (const l of list) {
      l.h *= scale
      y -= l.h / 2
      l.y = y
      y -= l.h / 2 + 0.012 * scale
    }
    slots = list
    layers.count = list.length
    list.forEach((l, i) => layers.setColorAt(i, l.color))
    if (layers.instanceColor) layers.instanceColor.needsUpdate = true
  }

  function writeMatrices(t: number) {
    slots.forEach((l, i) => {
      const lift = l.drop > 0 ? l.drop * 1.6 : 0
      const wob = l.r * (l.band ? 1 + Math.sin(t * 0.8 + i) * 0.004 : 1)
      p.set(0, l.y + lift, 0)
      s.set(wob, l.h, wob)
      m4.compose(p, q, s)
      layers.setMatrixAt(i, m4)
    })
    layers.instanceMatrix.needsUpdate = true
  }

  // Interaction
  let dragging = false
  let lastX = 0
  let spin = 0
  let vel = 0
  let hover = -1
  const ray = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  const el = renderer.domElement
  el.style.touchAction = 'pan-y'
  el.addEventListener('pointerdown', e => {
    dragging = true
    lastX = e.clientX
  })
  addEventListener('pointerup', () => (dragging = false))
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect()
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    if (dragging) {
      vel = (e.clientX - lastX) * 0.006
      spin += vel
      lastX = e.clientX
    }
    pick(e.clientX - r.left, e.clientY - r.top)
  })
  el.addEventListener('pointerleave', () => {
    hover = -1
    if (opts.tooltip) opts.tooltip.hidden = true
  })

  function pick(x: number, y: number) {
    ray.setFromCamera(mouse, camera)
    const hit = ray.intersectObject(layers)[0]
    const idx = hit?.instanceId ?? -1
    if (idx === hover) return
    hover = idx
    const tip = opts.tooltip
    if (!tip) return
    const band = idx >= 0 ? slots[idx]?.band : undefined
    if (!band) {
      tip.hidden = true
      return
    }
    tip.hidden = false
    tip.style.left = `${Math.min(x + 18, host.clientWidth - 260)}px`
    tip.style.top = `${Math.max(8, y - 20)}px`
    tip.innerHTML = `<b class="room-${esc(band.room)}">${esc(ROOM_LABEL[band.room] || band.room)} · ${esc(band.kind || 'memory')}</b><span>${esc(ago(band.at))}${band.status === 'pending' ? ', writing to Walrus' : band.url ? ', stored on Walrus' : ''}</span>${band.text ? `<p>${esc(band.text.slice(0, 140))}${band.text.length > 140 ? '…' : ''}</p>` : ''}`
  }

  const v3 = new THREE.Vector3()
  let labelSig = ''
  function placeLabels() {
    const w = host.clientWidth
    if (w < 560) {
      labelHost.innerHTML = ''
      labelSig = ''
      return
    }
    const top = slots.map((l, i) => ({ l, i })).filter(x => x.l.band).slice(0, 3)
    const sig = top.map(x => `${x.l.band!.room}${x.l.band!.at}${x.l.band!.status}`).join('|')
    if (sig !== labelSig) {
      labelSig = sig
      labelHost.innerHTML = top
        .map(x => `<div class="core-label room-${esc(x.l.band!.room)}"><b>${esc(ROOM_LABEL[x.l.band!.room] || x.l.band!.room)} · ${esc(x.l.band!.kind || 'memory')}</b><span>${esc(ago(x.l.band!.at))}${x.l.band!.status === 'pending' ? ', writing' : x.l.band!.url ? ', on Walrus' : ''}</span></div>`)
        .join('')
    }
    const els = labelHost.children
    top.forEach((x, k) => {
      v3.set(1.45, x.l.y, 0).applyMatrix4(group.matrixWorld).project(camera)
      const sx = (v3.x * 0.5 + 0.5) * w
      const sy = (-v3.y * 0.5 + 0.5) * host.clientHeight
      const el = els[k] as HTMLElement
      if (el) el.style.transform = `translate(${Math.round(Math.min(sx + 40, w - 200))}px, ${Math.round(sy - 14 + k * 34)}px)`
    })
  }

  function resize() {
    const w = host.clientWidth || 1
    const h = host.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const narrow = w / h < 0.8
    const dist = (opts.tall ? 19 : 17.5) * (narrow ? 1.12 : 1)
    camera.position.set(Math.sin(0.35) * dist, 2.4, Math.cos(0.35) * dist)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()

  let visible = true
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
  io.observe(host)

  let ringT = -1
  const onMemory = (e: Event) => {
    const room = (e as CustomEvent).detail?.room || 'ledger'
    bands = [{ room, at: Date.now(), status: 'pending', kind: 'new' }, ...bands]
    layout(0)
    ringT = 0
    ;(ring.material as THREE.MeshBasicMaterial).color.set(ROOM_COLOR[room] ?? 0x8cc5d6)
  }
  bus.addEventListener('memory', onMemory)

  const clock = new THREE.Clock()
  let raf = 0
  function frame() {
    raf = requestAnimationFrame(frame)
    if (!visible || document.hidden) return
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime
    if (!dragging) {
      vel *= 0.94
      spin += vel + (reduced ? 0 : dt * 0.12)
    }
    group.rotation.y = spin
    group.position.y = reduced ? 0 : Math.sin(t * 0.5) * 0.05
    for (const l of slots) if (l.drop > 0) l.drop = Math.max(0, l.drop - dt * (reduced ? 10 : 1.4))
    if (ringT >= 0) {
      ringT += dt * (reduced ? 4 : 0.7)
      const top = slots[0]?.y ?? H / 2
      ring.position.y = top - ringT * H
      ;(ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - ringT)
      if (ringT > 1) ringT = -1
    }
    bubbles.rotation.y = -t * 0.03
    writeMatrices(t)
    placeLabels()
    renderer.render(scene, camera)
  }
  layout()
  frame()

  return {
    setBands(b) {
      bands = b
      layout()
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      bus.removeEventListener('memory', onMemory)
      renderer.dispose()
      el.remove()
      labelHost.remove()
    },
  }
}
