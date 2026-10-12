/**
 * Maquete holográfica: a área recortada num disco, prédios translúcidos com arestas acesas, seus dados
 * como feixes de luz, e as vistas técnicas (planta e fachadas) ao lado da vista principal.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MaqueteData, XY } from "./extract";

export interface MaqueteView {
  id: "plan" | "south" | "east";
  label: string;
}

/** Vistas técnicas desenhadas nos cantos (mesma cena, câmeras ortográficas). */
export const MAQUETE_VIEWS: MaqueteView[] = [
  { id: "plan", label: "Planta" },
  { id: "south", label: "Fachada sul" },
  { id: "east", label: "Fachada leste" },
];

const HOLO = new THREE.Color("#5fd4ff");
const SLAB_TOP = "#0b1428";
const SLAB_DEPTH = 18;

/** Layout das vistas técnicas: coluna à direita (ou embaixo, em tela estreita). */
function insetRects(w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  const narrow = w < 760;
  const gap = 12;
  if (narrow) {
    // Faixa acima da barra de controles (que fica no rodapé).
    const iw = (w - gap * 4) / 3;
    const ih = Math.min(iw * 0.75, h * 0.2);
    return [0, 1, 2].map((i) => ({ x: gap + i * (iw + gap), y: 128, w: iw, h: ih }));
  }
  const iw = Math.min(280, w * 0.24);
  const ih = (h - gap * 4) / 3;
  return [0, 1, 2].map((i) => ({ x: w - iw - gap, y: h - gap - (i + 1) * ih - i * gap, w: iw, h: ih }));
}

export class MaqueteScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  private scan: THREE.Mesh | null = null;
  private beams: THREE.InstancedMesh | null = null;
  private pulse: THREE.Mesh | null = null;
  private radius = 300;
  private top = 60;
  private frame = 0;
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  showViews = true;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor("#050913");
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.scene.fog = new THREE.Fog("#050913", 1500, 6000);
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight("#9fc6ff", "#0a0f1e", 1.1));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(600, 900, 400);
    this.scene.add(sun);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  set autoRotate(on: boolean) {
    this.controls.autoRotate = on;
  }

  get autoRotate(): boolean {
    return this.controls.autoRotate;
  }

  /** Retângulos (em px, origem no canto superior esquerdo) das vistas técnicas, para os rótulos em HTML. */
  viewRects(): { id: MaqueteView["id"]; label: string; left: number; top: number; width: number; height: number }[] {
    const { clientWidth: w, clientHeight: h } = this.container;
    return insetRects(w, h).map((r, i) => ({ ...MAQUETE_VIEWS[i]!, left: r.x, top: h - r.y - r.h, width: r.w, height: r.h }));
  }

  setData(data: MaqueteData): void {
    this.clear();
    const R = data.radiusM;
    this.radius = R;
    this.top = Math.max(40, ...data.buildings.map((b) => b.height));

    this.root.add(this.slab(data));
    this.root.add(...this.buildings(data));
    if (data.points.length) this.root.add(this.pointBeams(data));
    this.root.add(this.rings(R));
    this.scan = this.scanPlane(R);
    this.root.add(this.scan);
    this.root.add(this.centerMarker(R));

    this.frameModel();
  }

  /** Câmera a uma distância em que o disco cabe na largura e na altura da vista. */
  private frameModel(): void {
    const R = this.radius;
    const aspect = Math.max(0.3, this.camera.aspect);
    const d = R * 2.9 * Math.max(1, 1.25 / aspect);
    this.camera.position.set(d * 0.62, d * 0.62, d * 0.78);
    this.controls.target.set(0, this.top * 0.15, 0);
    this.controls.minDistance = R * 0.6;
    this.controls.maxDistance = R * 6;
    this.controls.update();
  }

  /** Imagem PNG do que está na tela (vista principal + vistas técnicas). */
  snapshot(): string {
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- Construção ----------

  private clear(): void {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        (m as THREE.MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    });
    this.root.clear();
    this.scan = null;
    this.beams = null;
    this.pulse = null;
  }

  /** Disco da área: chão desenhado (ruas, água, verde) num canvas e laterais em degradê. */
  private slab(data: MaqueteData): THREE.Group {
    const R = data.radiusM;
    const size = 2048;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const s = size / (2 * R);
    const px = ([x, y]: XY): XY => [size / 2 + x * s, size / 2 - y * s];
    ctx.fillStyle = SLAB_TOP;
    ctx.fillRect(0, 0, size, size);
    // Grade de 50 m, como papel milimetrado.
    ctx.strokeStyle = "rgba(95, 212, 255, 0.07)";
    ctx.lineWidth = 1;
    for (let m = -R; m <= R; m += 50) {
      const [a] = px([m, 0]);
      ctx.beginPath();
      ctx.moveTo(a, 0);
      ctx.lineTo(a, size);
      ctx.stroke();
      const [, b] = px([0, m]);
      ctx.beginPath();
      ctx.moveTo(0, b);
      ctx.lineTo(size, b);
      ctx.stroke();
    }
    const fillRings = (polys: XY[][][], color: string) => {
      ctx.fillStyle = color;
      for (const rings of polys) {
        ctx.beginPath();
        for (const ring of rings) ring.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
        ctx.fill("evenodd");
      }
    };
    fillRings(data.parks, "#0f2a26");
    fillRings(data.water, "#0d2b4d");
    const widths: Record<string, number> = { highway: 14, major_road: 10, medium_road: 7, minor_road: 5, path: 2, rail: 3 };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const pass of [0, 1]) {
      for (const r of data.roads) {
        const wM = widths[r.kind] ?? 4;
        ctx.strokeStyle = pass === 0 ? "rgba(95, 212, 255, 0.10)" : r.kind === "path" ? "rgba(140, 170, 210, 0.35)" : "rgba(150, 220, 255, 0.55)";
        ctx.lineWidth = pass === 0 ? wM * s * 1.9 : Math.max(1.2, wM * s * 0.35);
        ctx.beginPath();
        r.line.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
        ctx.stroke();
      }
    }
    // Sombra dos prédios no chão (planta), para a vista de cima ler bem.
    ctx.fillStyle = "rgba(95, 212, 255, 0.12)";
    for (const b of data.buildings) {
      ctx.beginPath();
      for (const ring of b.rings) ring.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
      ctx.fill("evenodd");
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const group = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CircleGeometry(R, 160), new THREE.MeshBasicMaterial({ map: texture }));
    top.rotation.x = -Math.PI / 2;
    group.add(top);
    const side = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.985, SLAB_DEPTH, 160, 1, true),
      new THREE.MeshStandardMaterial({ color: "#13213f", emissive: "#0a1730", roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }),
    );
    side.position.y = -SLAB_DEPTH / 2;
    group.add(side);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(R * 0.985, 160), new THREE.MeshBasicMaterial({ color: "#060b17" }));
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -SLAB_DEPTH;
    group.add(bottom);
    return group;
  }

  /** Prédios: um só mesh translúcido (cor por vértice) + arestas acesas. */
  private buildings(data: MaqueteData): THREE.Object3D[] {
    const geoms: THREE.BufferGeometry[] = [];
    const edges: THREE.BufferGeometry[] = [];
    const neutral = new THREE.Color("#7fb6ff");
    for (const b of data.buildings) {
      const [outer, ...holes] = b.rings;
      if (!outer || outer.length < 4) continue;
      const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of holes) if (h.length >= 4) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      const depth = Math.max(1, b.height - b.base);
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      // Extrusão sai no eixo Z: deita no chão (Y para cima, norte = -Z).
      g.rotateX(-Math.PI / 2);
      g.translate(0, b.base, 0);
      const color = b.color ? new THREE.Color(b.color) : neutral;
      const n = g.getAttribute("position").count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      // Sem uv/normal diferentes entre partes: o merge exige os mesmos atributos.
      g.deleteAttribute("uv");
      geoms.push(g);
      edges.push(new THREE.EdgesGeometry(g, 30));
    }
    if (geoms.length === 0) return [];
    const body = new THREE.Mesh(
      mergeGeometries(geoms),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.62,
        roughness: 0.35,
        metalness: 0.1,
        emissive: "#0b2350",
        emissiveIntensity: 0.6,
        depthWrite: true,
      }),
    );
    const lines = new THREE.LineSegments(
      mergeGeometries(edges),
      new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    for (const g of [...geoms, ...edges]) g.dispose();
    return [body, lines];
  }

  /** Seus dados: feixes verticais da cor da categoria, saindo do topo do prédio (ou da rua). */
  private pointBeams(data: MaqueteData): THREE.Object3D {
    const group = new THREE.Group();
    const dense = data.points.length > 600;
    const beamH = dense ? Math.max(10, this.top * 0.1) : Math.max(24, this.top * 0.25);
    const beam = new THREE.CylinderGeometry(dense ? 0.5 : 0.9, dense ? 0.5 : 0.9, beamH, 6, 1, true);
    beam.translate(0, beamH / 2, 0);
    const mesh = new THREE.InstancedMesh(
      beam,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      data.points.length,
    );
    const dot = new THREE.InstancedMesh(new THREE.SphereGeometry(dense ? 1.8 : 3, 10, 6), new THREE.MeshBasicMaterial(), data.points.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    data.points.forEach((p, i) => {
      m.makeTranslation(p.x, p.ground + 0.5, -p.y);
      mesh.setMatrixAt(i, m);
      m.makeTranslation(p.x, p.ground + beamH, -p.y);
      dot.setMatrixAt(i, m);
      c.set(p.color);
      mesh.setColorAt(i, c);
      dot.setColorAt(i, c);
    });
    this.beams = mesh;
    group.add(mesh, dot);
    return group;
  }

  /** Anel aceso na borda, anel externo com marcas a cada 10° e o norte. */
  private rings(R: number): THREE.Object3D {
    const group = new THREE.Group();
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.995, R * 1.008, 200),
      new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.4;
    group.add(glow);
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.12, R * 1.125, 200),
      new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -SLAB_DEPTH;
    group.add(outer);
    const ticks: number[] = [];
    for (let deg = 0; deg < 360; deg += 10) {
      const a = (deg * Math.PI) / 180;
      const len = deg % 90 === 0 ? 0.07 : 0.03;
      ticks.push(Math.sin(a) * R * 1.125, -SLAB_DEPTH, -Math.cos(a) * R * 1.125, Math.sin(a) * R * (1.125 + len), -SLAB_DEPTH, -Math.cos(a) * R * (1.125 + len));
    }
    const tickGeom = new THREE.BufferGeometry();
    tickGeom.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
    group.add(new THREE.LineSegments(tickGeom, new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.6 })));
    // Seta do norte.
    const arrow = new THREE.Shape([new THREE.Vector2(0, R * 0.09), new THREE.Vector2(-R * 0.025, 0), new THREE.Vector2(R * 0.025, 0)]);
    const north = new THREE.Mesh(new THREE.ShapeGeometry(arrow), new THREE.MeshBasicMaterial({ color: HOLO, side: THREE.DoubleSide }));
    north.rotation.x = -Math.PI / 2;
    north.position.set(0, -SLAB_DEPTH + 0.5, -R * 1.2);
    group.add(north);
    return group;
  }

  /** O ponto escolhido: feixe branco acima de tudo e um anel que pulsa no chão. */
  private centerMarker(R: number): THREE.Object3D {
    const group = new THREE.Group();
    const h = this.top * 1.25;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, h, 10, 1, true).translate(0, h / 2, 0),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(R * 0.022), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    head.position.y = h + R * 0.025;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.04, R * 0.05, 64),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.6;
    this.pulse = ring;
    group.add(beam, head, ring);
    return group;
  }

  /** Plano de varredura que sobe e desce sobre os prédios. */
  private scanPlane(R: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(R, 120),
      new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.07, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.99, R, 160),
      new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.add(edge);
    return mesh;
  }

  // ---------- Desenho ----------

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const t = this.clock.getElapsedTime();
    if (this.scan) {
      const k = (Math.sin(t * 0.55) + 1) / 2;
      this.scan.position.y = 1 + k * this.top * 1.05;
    }
    if (this.beams) (this.beams.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(t * 2.2) * 0.25;
    if (this.pulse) {
      const k = (t * 0.6) % 1;
      this.pulse.scale.setScalar(1 + k * 3);
      (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    }
    this.controls.update();
    this.render();
  };

  private render(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    // Com as vistas técnicas à direita, o modelo centraliza no espaço que sobra.
    // Em tela estreita, as vistas ficam embaixo e os números em cima: centraliza no meio livre.
    let dx = 0;
    let dy = 0;
    if (this.showViews && w >= 760) dx = (Math.min(280, w * 0.24) + 12) / 2;
    else if (this.showViews) {
      const ih = Math.min(((w - 48) / 3) * 0.75, h * 0.2);
      const freeTop = h * 0.3;
      const freeBottom = h - 128 - ih;
      dy = h / 2 - (freeTop + freeBottom) / 2;
    }
    if (dx || dy) this.camera.setViewOffset(w, h, dx, dy, w, h);
    else this.camera.clearViewOffset();
    r.render(this.scene, this.camera);
    if (!this.showViews) return;

    // Vistas técnicas: ortográficas, sem varredura nem rotação.
    const scanVisible = this.scan?.visible ?? false;
    if (this.scan) this.scan.visible = false;
    const R = this.radius * 1.08;
    r.setScissorTest(true);
    for (const [i, rect] of insetRects(w, h).entries()) {
      const view = MAQUETE_VIEWS[i]!;
      const aspect = rect.w / rect.h;
      const cam = this.ortho;
      if (view.id === "plan") {
        const half = Math.max(R, R / aspect);
        cam.left = -half * aspect;
        cam.right = half * aspect;
        cam.top = half;
        cam.bottom = -half;
        cam.position.set(0, 5000, 0);
        cam.up.set(0, 0, -1);
        cam.lookAt(0, 0, 0);
      } else {
        const hh = Math.max((this.top + SLAB_DEPTH) * 0.62, R / aspect / 2);
        cam.left = -R;
        cam.right = R;
        cam.top = hh + this.top * 0.35;
        cam.bottom = -hh + this.top * 0.35 - SLAB_DEPTH;
        cam.up.set(0, 1, 0);
        if (view.id === "south") cam.position.set(0, this.top * 0.3, 5000);
        else cam.position.set(5000, this.top * 0.3, 0);
        cam.lookAt(0, this.top * 0.3, 0);
      }
      cam.updateProjectionMatrix();
      r.setViewport(rect.x, rect.y, rect.w, rect.h);
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.setClearColor("#081124");
      r.clear();
      r.render(this.scene, cam);
    }
    r.setClearColor("#050913");
    r.setScissorTest(false);
    if (this.scan) this.scan.visible = scanVisible;
  }
}
