// The Orasentra relic: a crystal of memory floating under an aurora.
// Every orbiting shard is a real memory sealed on Walrus. A new memory flies out of the core.

import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { bus, prefersReducedMotion, esc, ago, ROOM_LABEL } from './lib'

export interface Shard {
  room: string
  kind?: string
  at: number
  text?: string
  url?: string
  status?: string
}

export interface RelicHandle {
  setShards(s: Shard[]): void
  destroy(): void
}

const ROOM_COLOR: Record<string, number> = { calls: 0xffb35c, watch: 0xff6f7d, pocket: 0x52e3b0, ledger: 0x9ad7ff }

const AURORA_FRAG = /* glsl */ `
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime;
  uniform vec2 uMouse;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  float ribbon(vec2 uv, float t, float seed, float height) {
    float x = uv.x * 1.6 + seed;
    float wave = fbm(vec2(x * 0.9 + t * 0.15, seed + t * 0.05)) * 0.55;
    float y = uv.y - height - wave;
    float band = exp(-pow(y * 7.5, 2.0));
    float streaks = 0.55 + 0.45 * fbm(vec2(x * 14.0, uv.y * 1.5 + t * 0.4 + seed));
    float rays = smoothstep(0.0, 0.35, uv.y - height - wave + 0.12) * exp(-max(0.0, y) * 3.2);
    return band * streaks + rays * 0.35 * streaks;
  }
  void main() {
    vec2 uv = vUv;
    uv.x *= uRes.x / uRes.y;
    float t = uTime;
    vec2 m = (uMouse - 0.5) * 0.06;
    vec3 sky = mix(vec3(0.015, 0.025, 0.07), vec3(0.03, 0.07, 0.14), smoothstep(0.0, 1.0, vUv.y));
    sky += vec3(0.02, 0.05, 0.08) * smoothstep(0.55, 0.0, abs(vUv.y - 0.25));
    float a1 = ribbon(uv + m, t, 1.3, 0.62);
    float a2 = ribbon(uv * vec2(0.8, 1.0) + m * 1.4, t * 1.2, 7.1, 0.72);
    float a3 = ribbon(uv * vec2(1.3, 1.0) - m, t * 0.8, 3.7, 0.54);
    vec3 col = sky;
    col += vec3(0.16, 0.95, 0.70) * a1 * 0.55;
    col += vec3(0.48, 0.36, 1.00) * a2 * 0.45;
    col += vec3(0.20, 0.70, 1.00) * a3 * 0.35;
    // stars
    vec2 g = vUv * uRes / 2.4;
    float s = hash(floor(g));
    float tw = 0.6 + 0.4 * sin(t * 2.0 + s * 40.0);
    col += vec3(0.85, 0.92, 1.0) * step(0.9975, s) * tw * smoothstep(0.25, 0.7, vUv.y) * 0.9;
    // horizon mist
    col = mix(col, vec3(0.05, 0.10, 0.16), smoothstep(0.32, 0.0, vUv.y) * 0.85);
    gl_FragColor = vec4(col, 1.0);
  }
`

function glowTexture(inner: string, outer: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, inner)
  grd.addColorStop(0.35, outer)
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function webglOk() {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export function mountRelic(host: HTMLElement, opts: { tooltip?: HTMLElement; compact?: boolean } = {}): RelicHandle {
  if (!webglOk()) {
    host.classList.add('relic-fallback')
    return { setShards() {}, destroy() {} }
  }
  const reduced = prefersReducedMotion()
  const mobile = matchMedia('(max-width: 760px)').matches
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.prepend(renderer.domElement)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x07121f, 0.045)
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  // Aurora sky, drawn first as a full screen quad.
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uMouse: { value: new THREE.Vector2(0.5, 0.5) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
      fragmentShader: AURORA_FRAG,
    }),
  )
  sky.frustumCulled = false
  sky.renderOrder = -10
  scene.add(sky)

  scene.add(new THREE.HemisphereLight(0x9fe8ff, 0x0b1424, 0.6))
  const key = new THREE.PointLight(0x7af0d0, 40, 30, 1.6)
  key.position.set(3, 4, 4)
  scene.add(key)
  const violet = new THREE.PointLight(0x8a6bff, 30, 30, 1.6)
  violet.position.set(-4, 2, -2)
  scene.add(violet)

  const relic = new THREE.Group()
  scene.add(relic)

  // The crystal: an elongated bipyramid with facets and glassy transmission.
  // A faceted water drop: the shape of Sui, cut like a gem.
  const profile: THREE.Vector2[] = []
  for (let i = 14; i >= 0; i--) {
    const a = (i / 14) * Math.PI
    profile.push(new THREE.Vector2(Math.max(0.0001, Math.sin(a) * Math.pow(Math.sin(a / 2), 1.3) * 1.05), Math.cos(a) * 1.75 + 0.15))
  }
  const crystalGeo = new THREE.LatheGeometry(profile, 9)
  crystalGeo.scale(1.15, 1.05, 1.15)
  crystalGeo.computeVertexNormals()
  const crystalMat = new THREE.MeshPhysicalMaterial({ color: 0xcff4ff, metalness: 0.15, roughness: 0.08, transparent: true, opacity: 0.5, flatShading: true, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 900], clearcoat: 1, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false })
  const crystal = new THREE.Mesh(crystalGeo, crystalMat)
  relic.add(crystal)
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(crystalGeo, 20), new THREE.LineBasicMaterial({ color: 0xbffcff, transparent: true, opacity: 0.35 }))
  relic.add(edges)

  // Inner core light and halo
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 2), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }))
  relic.add(core)
  // An inner glow volume so the crystal reads as lit from within.
  const innerGeo = crystalGeo.clone()
  innerGeo.scale(0.6, 0.62, 0.6)
  innerGeo.translate(0, -0.25, 0)
  const inner = new THREE.Mesh(innerGeo, new THREE.MeshBasicMaterial({ color: 0x5fe8d0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  relic.add(inner)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,236,190,1)', 'rgba(120,240,210,0.35)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  halo.scale.set(2.6, 2.6, 1)
  halo.renderOrder = 10
  halo.material.depthTest = false
  relic.add(halo)
  const bigHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(80,220,200,0.35)', 'rgba(120,100,255,0.12)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  bigHalo.scale.set(12, 12, 1)
  bigHalo.renderOrder = -1
  relic.add(bigHalo)

  // Rune rings
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  const ring1 = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.57, 160), ringMat)
  ring1.rotation.x = Math.PI / 2.25
  relic.add(ring1)
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(3.25, 3.262, 160, 1, 0, Math.PI * 1.6), ringMat.clone())
  ;(ring2.material as THREE.MeshBasicMaterial).opacity = 0.16
  ring2.rotation.x = Math.PI / 2.1
  ring2.rotation.y = 0.2
  relic.add(ring2)
  const ticks = new THREE.Group()
  for (let i = 0; i < 72; i++) {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.012, i % 6 ? 0.08 : 0.2), ringMat)
    const a = (i / 72) * Math.PI * 2
    tick.position.set(Math.cos(a) * 2.56, 0, Math.sin(a) * 2.56)
    tick.lookAt(0, 0, 0)
    tick.rotateX(Math.PI / 2)
    ticks.add(tick)
  }
  ticks.rotation.x = ring1.rotation.x - Math.PI / 2
  relic.add(ticks)

  // Memory shards
  const MAX = 72
  const shardGeo = new THREE.IcosahedronGeometry(0.1, 0)
  shardGeo.scale(0.8, 1.25, 0.8)
  const shardMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 })
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, MAX)
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(shards)
  type Slot = { r: number; tilt: number; phase: number; speed: number; y: number; data?: Shard; born: number }
  let slots: Slot[] = []
  let data: Shard[] = []
  const colorOf = (s?: Shard) => new THREE.Color(s ? ROOM_COLOR[s.room] ?? 0x9ad7ff : 0x7fb4d8)

  function layout() {
    const count = Math.min(MAX, Math.max(36, data.length))
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    slots = Array.from({ length: count }, (_, i) => ({
      r: 2.0 + rnd() * 1.9,
      tilt: (rnd() - 0.5) * 0.7,
      phase: rnd() * Math.PI * 2,
      speed: 0.05 + rnd() * 0.08,
      y: (rnd() - 0.5) * 2.4,
      data: data[i],
      born: -1,
    }))
    shards.count = count
    slots.forEach((s, i) => {
      const c = colorOf(s.data)
      if (!s.data) c.multiplyScalar(0.6)
      shards.setColorAt(i, c)
    })
    if (shards.instanceColor) shards.instanceColor.needsUpdate = true
  }

  // Dust rising from the ice
  const N = reduced ? 160 : mobile ? 280 : 600
  const dustPos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) dustPos.set([(Math.random() - 0.5) * 24, Math.random() * 10 - 3.5, (Math.random() - 0.5) * 16 - 2], i * 3)
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.05, map: glowTexture('rgba(220,250,255,1)', 'rgba(140,230,255,0.3)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }))
  scene.add(dust)

  // Ice floor with a soft reflection glow
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float d = distance(vUv, vec2(0.5)); float glow = exp(-d * 9.0) * 0.55; float rings = 0.0; vec3 c = vec3(0.30, 0.85, 0.80) * glow + vec3(0.55, 0.85, 1.0) * rings; gl_FragColor = vec4(c, (glow + rings) * 0.9); }`,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -3.1
  scene.add(floor)

  // Interaction
  const mouse = new THREE.Vector2(0, 0)
  const smooth = new THREE.Vector2(0, 0)
  let hover = -1
  const ray = new THREE.Raycaster()
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect()
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    if (opts.tooltip && e.target === renderer.domElement) pick(e.clientX - r.left, e.clientY - r.top)
  }
  host.addEventListener('pointermove', onMove)

  function pick(x: number, y: number) {
    ray.setFromCamera(mouse, camera)
    const hit = ray.intersectObject(shards)[0]
    const idx = hit?.instanceId ?? -1
    if (idx === hover) return
    hover = idx
    const tip = opts.tooltip!
    const s = idx >= 0 ? slots[idx]?.data : undefined
    if (!s) {
      tip.hidden = true
      renderer.domElement.style.cursor = ''
      return
    }
    renderer.domElement.style.cursor = 'pointer'
    tip.hidden = false
    tip.style.left = `${Math.min(x + 16, host.clientWidth - 270)}px`
    tip.style.top = `${Math.max(12, y - 24)}px`
    tip.innerHTML = `<b class="room-${esc(s.room)}">${esc(ROOM_LABEL[s.room] || s.room)} · ${esc(s.kind || 'memory')}</b><span>${esc(ago(s.at))}${s.status === 'pending' ? ', sealing on Walrus' : s.url ? ', sealed on Walrus' : ''}</span>${s.text ? `<p>${esc(s.text.slice(0, 150))}${s.text.length > 150 ? '…' : ''}</p>` : ''}`
  }
  renderer.domElement.addEventListener('click', () => {
    const s = hover >= 0 ? slots[hover]?.data : undefined
    if (s?.url) window.open(s.url, '_blank', 'noopener')
  })

  function resize() {
    const w = host.clientWidth || 1
    const h = host.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    ;(sky.material as THREE.ShaderMaterial).uniforms.uRes.value.set(w, h)
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()

  let visible = true
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
  io.observe(host)

  let burst = -1
  let burstColor = new THREE.Color(0x9ad7ff)
  const onMemory = (e: Event) => {
    const room = (e as CustomEvent).detail?.room || 'ledger'
    data = [{ room, at: Date.now(), status: 'pending', kind: 'new' }, ...data]
    layout()
    slots[0].born = 0
    burst = 0
    burstColor = new THREE.Color(ROOM_COLOR[room] ?? 0x9ad7ff)
  }
  bus.addEventListener('memory', onMemory)

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e3 = new THREE.Euler()
  const p = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const clock = new THREE.Clock()
  let raf = 0

  function frame() {
    raf = requestAnimationFrame(frame)
    if (!visible || document.hidden) return
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = reduced ? 0 : clock.elapsedTime
    smooth.lerp(mouse, 0.04)
    const wide = camera.aspect > 1.1
    const offset = opts.compact ? 0 : wide ? 2.4 : 0
    if (wide || opts.compact) {
      camera.position.set(offset + smooth.x * 0.8 - 1.2, 0.8 + smooth.y * 0.5, opts.compact ? 14 : 13)
      camera.lookAt(offset - 1.2, 0.1, 0)
    } else {
      camera.position.set(smooth.x * 0.5, 1.2, 20)
      camera.lookAt(0, -0.6, 0)
    }
    relic.position.set(wide && !opts.compact ? 2.8 : 0, (wide || opts.compact ? 0 : 2.3) + Math.sin(t * 0.8) * 0.12, 0)
    crystal.rotation.y = t * 0.25
    edges.rotation.y = crystal.rotation.y
    inner.rotation.y = -t * 0.4
    ;(inner.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 1.6) * 0.06
    core.scale.setScalar(1 + Math.sin(t * 2.2) * 0.06 + (burst >= 0 ? (1 - burst) * 0.8 : 0))
    halo.material.opacity = 0.85 + Math.sin(t * 2.2) * 0.1
    ring1.rotation.z = t * 0.08
    ticks.rotation.y = -t * 0.05
    ring2.rotation.z = -t * 0.05
    if (burst >= 0) {
      burst += dt * 0.9
      ;(core.material as THREE.MeshBasicMaterial).color.copy(new THREE.Color(0xfff1c9).lerp(burstColor, Math.max(0, 1 - burst)))
      if (burst > 1) burst = -1
    }
    slots.forEach((s, i) => {
      const a = s.phase + t * s.speed
      let r = s.r
      let y = s.y
      if (s.born >= 0) {
        s.born = Math.min(1, s.born + dt * 0.7)
        const k = 1 - Math.pow(1 - s.born, 3)
        r *= k
        y *= k
        if (s.born >= 1) s.born = -1
      }
      p.set(Math.cos(a) * r, y + Math.sin(a * 2 + s.tilt) * 0.25, Math.sin(a) * r).applyAxisAngle(new THREE.Vector3(1, 0, 0), s.tilt)
      p.add(relic.position)
      e3.set(t * 0.6 + i, t * 0.9 + i * 0.3, 0)
      q.setFromEuler(e3)
      const big = s.data ? (i === hover ? 1.9 : 1.15) : 0.75
      sc.setScalar(big)
      m4.compose(p, q, sc)
      shards.setMatrixAt(i, m4)
    })
    shards.instanceMatrix.needsUpdate = true
    const pos = dustGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < N; i++) {
      let y = pos.getY(i) + dt * 0.18
      if (y > 7) y = -3.5
      pos.setY(i, y)
    }
    pos.needsUpdate = true
    const u = (sky.material as THREE.ShaderMaterial).uniforms
    u.uTime.value = t
    u.uMouse.value.set(smooth.x * 0.5 + 0.5, smooth.y * 0.5 + 0.5)
    ;(floor.material as THREE.ShaderMaterial).uniforms.uTime.value = t
    renderer.render(scene, camera)
  }
  layout()
  frame()

  return {
    setShards(s) {
      data = s
      layout()
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      bus.removeEventListener('memory', onMemory)
      host.removeEventListener('pointermove', onMove)
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
