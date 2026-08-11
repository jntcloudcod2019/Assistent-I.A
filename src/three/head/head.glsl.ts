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
  attribute float aDetail;
  attribute float aGlow;

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
  /** Deve espelhar EYE_ASPECT em faceModel.ts. */
  uniform float uEyeAspect;
  /** 0 = olhos abertos, 1 = pálpebra totalmente fechada. */
  uniform float uBlink;

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
    float fill = max(0.0, dot(vn, normalize(vec3(0.6, -0.1, 0.5)))) * 0.2;
    // Ambiente: sem ele, tudo que aponta para baixo — filtro do nariz, sob o
    // lábio, sob o queixo — vira um buraco preto e o rosto lê como caveira.
    float ambient = front * 0.32;

    float scan = exp(-pow((p.y - uScanY) * 13.0, 2.0));
    float pulse = 0.6 + 0.4 * sin(uTime * 1.6 + aSeed * 6.2831);

    // Hierarquia das referências: o crânio é uma casca quase apagada e a luz se
    // acumula nas feições. Iluminar tudo por igual é o que fazia a cabeça virar
    // uma massa sólida em vez de um wireframe vazado.
    float structural = 0.035 + ambient * 0.14 + key * 0.11 + fill * 0.3 + fres * 0.32;
    float featureLit = aGlow * (0.5 + key * 0.9 + fres * 0.5);
    vBright = structural + featureLit + scan * 0.22 + uLevel * 0.4;

    // Nós acesos: uma minoria dos vértices brilha muito mais que o resto, que é
    // o que dá a leitura de "pontos de dado" sobre a malha. Vale só para a
    // malha e as partículas — nos retalhos densos viraria mancha branca.
    float isPatch = step(0.001, aDetail);
    float node = step(0.91, hash11(aSeed * 37.0 + 1.7)) * (1.0 - isPatch);
    vBright += node * (0.28 + aGlow * 0.9);

    // As feições recebem piso ou teto de emissão em vez de acréscimo: assim
    // leem independentemente de para onde a normal aponta.
    float sizeScale = 1.0;
    float r = aRegion;

    // Nos retalhos oculares aDetail é o raio isotrópico da íris e aSeed carrega
    // o ângulo polar da abertura — juntos dão pupila, fibras, limbo e reflexo.
    // O ângulo precisa ser reprojetado no espaço isotrópico, senão o reflexo
    // escorrega para fora da íris nas laterais.
    float ang = aSeed * 6.2831;
    float phi = atan(sin(ang), cos(ang) * uEyeAspect);
    vec2 pol = vec2(cos(phi), sin(phi)) * aDetail;
    vec2 gd = pol - vec2(-0.32, 0.34);
    float glint = exp(-42.0 * dot(gd, gd));

    // Piscada. aDetail é o raio isotrópico da íris, então a altura do ponto
    // dentro da fenda precisa ser desfeita do fator de aspecto antes de saber
    // quem já ficou debaixo da pálpebra.
    float kIso = length(vec2(cos(ang) * uEyeAspect, sin(ang)));
    float dvN = sin(ang) * (aDetail / max(kIso, 1e-4));   // -1 topo, +1 base
    float lidEdge = mix(-1.25, 1.25, uBlink);
    float covered = 1.0 - smoothstep(lidEdge - 0.06, lidEdge + 0.06, dvN);
    // Linha de cílios acompanhando a borda da pálpebra.
    float lashDist = (dvN - lidEdge) * 26.0;
    float lash = exp(-lashDist * lashDist) * step(0.02, uBlink);
    // Pálpebra fechada: pele um pouco mais escura, com os cílios marcados.
    float lidShade = vBright * 0.72 * (1.0 - lash * 0.85);

    // Regiões oculares viram pele enquanto cobertas, para que a cor azul da
    // íris não vaze por cima da pálpebra fechada.
    float regionOut = r;

    if (r > 8.5) {                                       // pálpebra
      vBright *= 0.1;
      sizeScale = 1.15;
    } else if (r > 7.5) {                                // narina
      vBright *= 0.1;
    } else if (r > 6.5) {                                // sobrancelha
      // Na referência as sobrancelhas são arcos ACESOS, não sombras — é o que
      // dá idade e expressão ao rosto. Piso alto com granulação por pelo.
      vBright = max(vBright, 0.85 + hash11(aSeed * 29.0) * 0.55);
      sizeScale = 1.35;
    } else if (r > 5.5) {                                // linha da boca
      vBright *= 0.06;
    } else if (r > 4.5) {                                // pupila — núcleo do mecanismo
      // Na referência o centro não é preto: é o ponto mais incandescente.
      float rad = aDetail;
      float core = exp(-rad * 7.0) * 1.1;
      float innerRing = smoothstep(0.72, 1.0, abs(fract(rad * 9.0) - 0.5) * 2.0);
      vBright = mix(0.3 + core + innerRing * 0.45 + glint * 1.2, lidShade, covered);
      regionOut = mix(r, 0.0, step(0.5, covered));
      sizeScale = 1.35;
    } else if (r > 3.5) {                                // íris — diafragma mecânico
      float rad = aDetail;

      // Anéis concêntricos: acende a aresta de cada anel, não o seu miolo.
      float ringPhase = rad * 4.6;
      float band = floor(ringPhase);
      float ringLine = smoothstep(0.72, 1.0, abs(fract(ringPhase) - 0.5) * 2.0);

      // Arcos segmentados, cada anel girando em sentido e ritmo próprios — é o
      // que faz ler como mecanismo de diafragma em vez de textura orgânica.
      float dir = mod(band, 2.0) * 2.0 - 1.0;
      float spin = uTime * (0.3 + band * 0.12) * dir;
      float seg = step(0.32, fract(phi / 6.2831 * (5.0 + band * 3.0) + spin));

      // Marcas radiais junto ao limbo, como escala de instrumento.
      float ticks = step(0.8, fract(phi / 6.2831 * 44.0)) * smoothstep(0.95, 1.22, rad);

      // Teto de brilho baixo por necessidade cromática: o roxo tem o azul já em
      // 1.0, então qualquer ganho acima de ~1.2 satura o canal e o olho volta a
      // ser um ponto branco — foi o que aconteceu com o azul antes.
      float limbal = smoothstep(1.12, 1.3, rad);
      float iris = (0.2 + ringLine * seg * 0.8 + ticks * 0.55) * (1.0 - limbal * 0.6) + glint * 1.1;
      vBright = mix(iris, lidShade, covered);
      regionOut = mix(r, 0.0, step(0.5, covered));
      sizeScale = 1.35;
    } else if (r > 2.5) {                                // cabelo
      vBright *= 0.35 + hash11(aSeed * 13.0) * 0.95;
      sizeScale = 1.3;
    } else if (r > 1.5) {                                // lábios
      // Sem piso fixo: um valor constante achataria a boca num oval aceso.
      // O realce cresce para o miolo do lábio e some na borda vermelhão.
      float edge = smoothstep(1.0, 0.72, aDetail);
      vBright *= 1.0 + edge * 0.5 + uJaw * 0.5;
    } else if (r > 0.5) {                                // esclera
      // Bem apagada: ela só emoldura o mecanismo, não compete com ele.
      vBright = mix(min(vBright * 0.3, 0.24), lidShade, covered);
      regionOut = mix(r, 0.0, step(0.5, covered));
    }
    vBright *= pulse * 0.3 + 0.78;

    vRegion = regionOut;
    // O verso continua visível — a cabeça é uma casca translúcida, não um
    // sólido —, só que bem mais fraco que a frente. Além disso a malha de
    // entorno recua em opacidade: só os retalhos e o que tem brilho de feição
    // vêm à frente.
    float meshFade = mix(0.3 + aGlow * 0.7, 1.0, isPatch);
    vAlpha = aFade * rv * aArea * mix(0.32, 1.0, front) * meshFade;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Os retalhos são detalhe fino, não nós da constelação: pontos menores.
    sizeScale *= (1.0 + node * 0.85) * mix(1.0, 0.45, isPatch);
    gl_PointSize = uSize * uPixelRatio * sizeScale * (1.0 + vBright * 0.3) / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

export const HEAD_FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform vec3 uColorAccent;
  uniform vec3 uColorIris;

  varying float vBright;
  varying float vRegion;
  varying float vAlpha;

  void main() {
    // Sprite compacto com halo curto: borda mole demais transforma os nós em
    // bolhas e apaga a malha por trás deles.
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.22, d);
    a *= a;

    vec3 col = mix(uColorEdge, uColorCore, clamp(vBright * 0.6, 0.0, 1.0));
    if (vRegion > 4.5 && vRegion < 5.5) col = mix(uColorIris, vec3(1.0), 0.3);    // núcleo
    else if (vRegion > 3.5 && vRegion < 4.5) col = uColorIris;                    // íris
    else if (vRegion > 0.5 && vRegion < 1.5) col = mix(col, vec3(0.86, 0.94, 1.0), 0.7); // esclera
    else if (vRegion > 1.5 && vRegion < 2.5) col = mix(col, uColorAccent, 0.3);   // lábios

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
    // Arestas de entorno bem mais fracas que os contornos das feições, para o
    // rosto não competir consigo mesmo.
    vAlpha = aFade * rv * mix(0.08, 0.4, front) * (0.2 + aGlow * 1.15);

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
