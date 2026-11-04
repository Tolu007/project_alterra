import * as THREE from 'three';

// Canvas-made textures: signs, labels and flags. Cached by key so each is drawn once.
const cache = new Map<string, THREE.Texture>();

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 800) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px "Figtree", "Segoe UI", system-ui, sans-serif`;
    s -= 2;
  } while (ctx.measureText(text).width > max && s > 10);
}

/** A shop sign: coloured board with bold text. */
export function signTexture(text: string, bg = '#fffaf0', fg = '#1f1d1a'): THREE.Texture {
  return make(`sign:${text}:${bg}:${fg}`, 512, 128, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#1f1d1a';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 502, 118);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, text, 470, 60);
    ctx.fillText(text, 256, 68);
  });
}

/** A floating place label: rounded pill, used on sprites. */
export function labelTexture(text: string, highlight = false): THREE.Texture {
  return make(`label:${text}:${highlight}`, 512, 112, (ctx) => {
    ctx.fillStyle = highlight ? '#f2b705' : 'rgba(255,250,240,0.95)';
    ctx.strokeStyle = '#1f1d1a';
    ctx.lineWidth = 8;
    const r = 50;
    ctx.beginPath();
    ctx.roundRect(6, 6, 500, 100, r);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1f1d1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, text, 450, 54);
    ctx.fillText(text, 256, 60);
  });
}

/** Name tag over a person. */
export function nameTexture(text: string, sub: string): THREE.Texture {
  return make(`name:${text}:${sub}`, 512, 140, (ctx) => {
    ctx.fillStyle = 'rgba(31,29,26,0.86)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 504, 132, 30);
    ctx.fill();
    ctx.fillStyle = '#fbf3e4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, text, 470, 48);
    ctx.fillText(text, 256, 50);
    ctx.fillStyle = '#f2b705';
    fitText(ctx, sub, 470, 34, 600);
    ctx.fillText(sub, 256, 104);
  });
}

export function flagTexture(): THREE.Texture {
  return make('flag:ng', 96, 64, (ctx) => {
    ctx.fillStyle = '#1e8f5a';
    ctx.fillRect(0, 0, 32, 64);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(32, 0, 32, 64);
    ctx.fillStyle = '#1e8f5a';
    ctx.fillRect(64, 0, 32, 64);
  });
}

export function partyFlagTexture(color: string, id: string, ink: string): THREE.Texture {
  return make(`pflag:${id}`, 128, 80, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 128, 80);
    ctx.fillStyle = ink;
    ctx.font = '900 34px "Figtree", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(id, 64, 42);
  });
}

/** A ₦ coin face for the marker above your head. */
export function coinTexture(): THREE.Texture {
  return make('coin', 128, 128, (ctx) => {
    ctx.fillStyle = '#f2b705';
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a87c00';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = '#1f1d1a';
    ctx.font = '900 76px "Figtree", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₦', 64, 70);
  });
}

/** A roadside billboard: a big headline over a smaller line. */
export function billboardTexture(head: string, sub: string, bg: string, fg: string): THREE.Texture {
  return make(`bb:${head}:${sub}:${bg}:${fg}`, 512, 256, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(0, 196, 512, 60);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, head, 470, 76, 900);
    ctx.fillText(head, 256, 100);
    fitText(ctx, sub, 460, 34, 700);
    ctx.fillText(sub, 256, 226);
  });
}
