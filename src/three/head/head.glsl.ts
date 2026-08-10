/**
 * GLSL do holograma.
 *
 * Mantido como template string (e não .vert/.frag + `?raw`) para que o
 * TypeScript enxergue os módulos sem declarações extras e os trechos comuns
 * possam ser compartilhados entre o shader de pontos e o de linhas.
 *
 * Os índices de região espelham `REGION` em faceModel.ts:
 *   0 pele · 1 esclera · 2 lábios · 3 cabelo · 4 íris
 *   5 pupila · 6 linha da boca · 7 sobrancelha · 8 narina
 */

/** Ruído, hash e a articulação da mandíbula — comuns aos dois shaders. */
const COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uThinking;
  uniform float uJaw;
  uniform float uScanY;
  uniform float uGlitch;
  uniform float uReveal;

  attribute vec3 aNormal;
  attribute float aJaw;
  attribute float aFade;
  attribute float aSeed;
  attribute float aArea;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  vec3 hash33(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(dot(hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
            dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
        mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
            dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
      mix(
        mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
            dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
        mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
            dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y),
      u.z);
  }

  // A mandíbula gira num eixo que passa pelos côndilos, não translada.
  vec3 applyJaw(vec3 p, float w) {
    const vec2 pivot = vec2(-0.02, -0.06); // (y, z)
    float a = uJaw * 0.3 * w;
    vec2 rel = p.yz - pivot;
    float c = cos(a);
    float s = sin(a);
    p.yz = pivot + vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
    return p;
  }

  // Deformações compartilhadas: respiração, reatividade ao áudio, turbulência
  // do raciocínio e bandas de glitch.
  vec3 deform(vec3 p, vec3 n, float seed) {
    p = applyJaw(p, aJaw);
    p += n * sin(uTime * 0.9 + seed * 6.2831) * 0.0035;
    p += n * uLevel * 0.03 * (0.4 + seed * 0.6);

    if (uThinking > 0.001) {
      vec3 q = p * 7.0 + uTime * 1.4;
      p += vec3(noise3(q), noise3(q + 11.0), noise3(q + 23.0)) * uThinking * 0.05;
    }

    if (uGlitch > 0.001) {
      float band = step(0.982, fract(p.y * 6.0 - uTime * 1.7));
      p.x += band * uGlitch * (hash11(seed * 91.0) * 2.0 - 1.0) * 0.06;
    }

    return p;
  }

  // Materialização no boot: os pontos convergem de fora para a superfície,
  // escalonados por seed para não chegarem todos juntos.
  float revealAmount(float seed) {
    return smoothstep(0.0, 1.0, clamp(uReveal * 1.7 - seed * 0.7, 0.0, 1.0));
  }
`

export const HEAD_VERT = /* glsl */ `
  ${COMMON}

  uniform float uSize;
  uniform float uPixelRatio;

  attribute float aRegion;

  varying float vBright;
  varying float vRegion;
  varying float vAlpha;

  void main() {
    vec3 p = deform(position, aNormal, aSeed);

    float rv = revealAmount(aSeed);
    vec3 origin = position + aNormal * 0.9 + vec3(0.0, aSeed * 0.7 - 0.35, 0.0);
    p = mix(origin, p, rv);

    vec3 vn = normalize(normalMatrix * aNormal);
    float facing = abs(vn.z);
    float fres = pow(1.0 - facing, 2.0);
    float front = smoothstep(-0.6, 0.4, vn.z);

    // Luz principal em espaço de visão. Sem este termo a nuvem só brilha na
    // silhueta e o rosto vira uma máscara escura — é o lambert que modela
    // nariz, arcadas e lábios.
    float key = max(0.0, dot(vn, normalize(vec3(-0.4, 0.42, 0.85))));
    float fill = max(0.0, dot(vn, normalize(vec3(0.6, -0.1, 0.5)))) * 0.28;
    // Ambiente: sem ele, tudo que aponta para baixo — filtro do nariz, sob o
    // lábio, sob o queixo — vira um buraco preto e o rosto lê como caveira.
    float ambient = front * 0.3;

    float scan = exp(-pow((p.y - uScanY) * 13.0, 2.0));
    float pulse = 0.6 + 0.4 * sin(uTime * 1.6 + aSeed * 6.2831);

    vBright = 0.16 + ambient + key * 0.62 + fill + fres * 0.45 + scan * 1.2 + uLevel * 0.5;

    // As feições recebem piso ou teto de emissão em vez de acréscimo: assim
    // leem independentemente de para onde a normal aponta.
    float sizeScale = 1.0;
    float r = aRegion;
    if (r > 7.5) {                                       // narina
      vBright *= 0.1;
    } else if (r > 6.5) {                                // sobrancelha
      vBright *= 0.3 + hash11(aSeed * 29.0) * 0.3;
      sizeScale = 1.25;
    } else if (r > 5.5) {                                // linha da boca
      vBright *= 0.12;
    } else if (r > 4.5) {                                // pupila
      vBright = 0.05;
      sizeScale = 1.1;
    } else if (r > 3.5) {                                // íris
      vBright = max(vBright, 2.1 + sin(uTime * 2.1) * 0.25);
      sizeScale = 1.25;
    } else if (r > 2.5) {                                // cabelo
      vBright *= 0.35 + hash11(aSeed * 13.0) * 0.95;
      sizeScale = 1.3;
    } else if (r > 1.5) {                                // lábios
      vBright = max(vBright, 0.75 + uJaw * 0.8);
    } else if (r > 0.5) {                                // esclera
      vBright = max(vBright + 0.25, 1.3);
    }
    vBright *= pulse * 0.3 + 0.78;

    vRegion = r;
    // aArea compensa o adensamento onde a seção transversal encolhe.
    vAlpha = aFade * rv * aArea * mix(0.2, 1.0, front);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uPixelRatio * sizeScale * (1.0 + vBright * 0.35) / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

export const HEAD_FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform vec3 uColorAccent;

  varying float vBright;
  varying float vRegion;
  varying float vAlpha;

  void main() {
    // Sprite radial suave: o glow nasce da sobreposição, não de post-processing.
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    a *= a;

    vec3 col = mix(uColorEdge, uColorCore, clamp(vBright * 0.6, 0.0, 1.0));
    if (vRegion > 3.5 && vRegion < 4.5) col = mix(col, uColorAccent, 0.75);       // íris
    else if (vRegion > 1.5 && vRegion < 2.5) col = mix(col, uColorAccent, 0.45);  // lábios

    float alpha = a * vAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col * (0.5 + vBright), alpha);
  }
`

export const LATTICE_VERT = /* glsl */ `
  ${COMMON}

  varying float vAlpha;
  varying float vScan;

  void main() {
    vec3 p = deform(position, aNormal, aSeed);
    float rv = revealAmount(aSeed);
    p = mix(position + aNormal * 0.9, p, rv);

    vec3 vn = normalize(normalMatrix * aNormal);
    float front = smoothstep(-0.4, 0.5, vn.z);

    vScan = exp(-pow((p.y - uScanY) * 9.0, 2.0));
    vAlpha = aFade * rv * mix(0.02, 0.2, front);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

export const LATTICE_FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uColorEdge;
  uniform vec3 uColorCore;

  varying float vAlpha;
  varying float vScan;

  void main() {
    vec3 col = mix(uColorEdge, uColorCore, vScan);
    float alpha = vAlpha * (1.0 + vScan * 2.5);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`
