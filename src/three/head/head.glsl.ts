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

  // Canais de expressão, alimentados por core/speech/speak.ts
  uniform float uBrow;
  uniform float uSquint;
  uniform float uSmile;
  uniform float uMouthWide;
  /** 0 = olhos abertos, 1 = pálpebra totalmente fechada. */
  uniform float uBlink;

  attribute float aRegion;

  varying float vBright;
  varying float vRegion;
  varying float vAlpha;
  /** Fração do brilho que vem do fundo branco, e não do anel colorido. */
  varying float vWhite;

  void main() {
    vWhite = 0.0;
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

    // Respiração do fundo do olho — lenta o bastante para ler como luz viva,
    // não como piscada de LED.
    float eyePulse = 0.5 + 0.5 * sin(uTime * 1.45);

    // Piscada. aDetail é o raio isotrópico da íris, então a altura do ponto
    // dentro da fenda precisa ser desfeita do fator de aspecto antes de saber
    // quem já ficou debaixo da pálpebra.
    float kIso = length(vec2(cos(ang) * uEyeAspect, sin(ang)));
    float dvN = sin(ang) * (aDetail / max(kIso, 1e-4));   // -1 topo, +1 base
    // O apertar de olhos compartilha o mecanismo da piscada, mas nunca fecha
    // por completo — é sustentado, não um evento.
    float lidEdge = mix(-1.25, 1.25, max(uBlink, uSquint * 0.5));
    float covered = 1.0 - smoothstep(lidEdge - 0.06, lidEdge + 0.06, dvN);
    // Linha de cílios acompanhando a borda da pálpebra.
    float lashDist = (dvN - lidEdge) * 26.0;
    float lash = exp(-lashDist * lashDist) * step(0.02, uBlink);
    // Pálpebra fechada: pele um pouco mais escura, com os cílios marcados.
    float lidShade = vBright * 0.72 * (1.0 - lash * 0.85);

    // Regiões oculares viram pele enquanto cobertas, para que a cor azul da
    // íris não vaze por cima da pálpebra fechada.
    float regionOut = r;

    if (r > 9.5) {                                       // circuito do crânio
      // Um pulso viaja pela trilha: o dado percorrendo a placa.
      float travel = fract(aDetail * 3.0 - uTime * 0.35);
      vBright = max(vBright, 0.85 + smoothstep(0.86, 1.0, travel) * 1.1);
      sizeScale = 1.1;
    } else if (r > 8.5) {                                // contorno da pálpebra
      // Traço aceso: é ele que dá a forma física do olho, já que o anel
      // holográfico por si só não define abertura nenhuma.
      vBright = max(vBright, 0.95);
      sizeScale = 1.1;
    } else if (r > 7.5) {                                // narina
      vBright *= 0.1;
    } else if (r > 6.5) {                                // sobrancelha
      // Na referência as sobrancelhas são arcos ACESOS, não sombras — é o que
      // dá idade e expressão ao rosto. Piso alto com granulação por pelo.
      vBright = max(vBright, 0.85 + hash11(aSeed * 29.0) * 0.55);
      // Levantar a sobrancelha é o gesto que mais carrega intenção no rosto.
      p.y += uBrow * 0.024;
      sizeScale = 1.35;
    } else if (r > 5.5) {                                // linha da boca
      vBright *= 0.06;
    } else if (r > 4.5) {                                // pupila
      // Escura, mas não morta: um resíduo do fundo branco sangra por ela, o
      // que dá a leitura de globo iluminado em vez de furo.
      float glowBase = 0.06 + eyePulse * 0.05;
      vBright = mix(glowBase, lidShade, covered);
      vWhite = 1.0 - covered;
      regionOut = mix(r, 0.0, step(0.5, covered));
      sizeScale = 1.0;
    } else if (r > 3.5) {                                // anel holográfico
      float rad = aDetail;
      float turn = phi / 6.2831;

      // Fundo branco fluorescente, com respiração lenta.
      float whiteBase = 0.34 + eyePulse * 0.2;

      // Anel principal: uma faixa fina e acesa, não um disco preenchido.
      float mainRing = exp(-pow((rad - 0.66) * 13.0, 2.0)) * 1.35;

      // Anel externo segmentado, girando num sentido.
      float segOuter = step(0.3, fract(turn * 7.0 + uTime * 0.34));
      float outer = exp(-pow((rad - 1.16) * 15.0, 2.0)) * segOuter * 1.05;

      // Escala de marcas girando ao contrário: dois sentidos opostos é o que
      // impede o olho de ler como um único disco rígido.
      float ticks = step(0.78, fract(turn * 34.0 - uTime * 0.22));
      ticks *= exp(-pow((rad - 0.95) * 17.0, 2.0)) * 0.7;

      // Circunferências finas de apoio, estáticas.
      float fine = smoothstep(0.82, 1.0, abs(fract(rad * 5.0) - 0.5) * 2.0) * 0.18;

      float ringLight = mainRing + outer + ticks + fine;
      float lit = whiteBase + ringLight;
      // A proporção entre fundo e anel decide a cor: onde o anel é forte vence
      // o amarelo, onde ele some sobra o branco.
      vWhite = (whiteBase / max(lit, 1e-4)) * (1.0 - covered);
      vBright = mix(lit, lidShade, covered);
      regionOut = mix(r, 0.0, step(0.5, covered));
      sizeScale = 1.2;
    } else if (r > 2.5) {                                // cabelo
      vBright *= 0.35 + hash11(aSeed * 13.0) * 0.95;
      sizeScale = 1.3;
    } else if (r > 1.5) {                                // lábios
      // Sem piso fixo: um valor constante achataria a boca num oval aceso.
      // O realce cresce para o miolo do lábio e some na borda vermelhão.
      float edge = smoothstep(1.0, 0.72, aDetail);
      vBright *= 1.0 + edge * 0.5 + uJaw * 0.5;
      // Sorriso ergue as comissuras, não o centro; a largura acompanha a vogal.
      float corner = smoothstep(0.015, 0.11, abs(p.x));
      p.y += uSmile * 0.016 * corner;
      p.x *= 1.0 + uMouthWide * 0.07;
    } else if (r > 0.5) {                                // esclera
      // Borda do globo: mesmo branco pulsante, um pouco mais fraco que o miolo.
      vBright = mix(0.26 + eyePulse * 0.14, lidShade, covered);
      vWhite = 1.0 - covered;
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

    // No olho, onde não há anel não há nada: o alfa segue o brilho, então o
    // desenho flutua sobre a pele em vez de assentar num disco preenchido.
    if ((r > 0.5 && r < 1.5) || (r > 3.5 && r < 5.5)) {
      vAlpha *= clamp(vBright * 1.7, 0.0, 1.0);
    }

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
  varying float vWhite;

  void main() {
    // Sprite compacto com halo curto: borda mole demais transforma os nós em
    // bolhas e apaga a malha por trás deles.
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.22, d);
    a *= a;

    vec3 col = mix(uColorEdge, uColorCore, clamp(vBright * 0.6, 0.0, 1.0));
    // Olho: o branco fluorescente do globo cede lugar ao amarelo onde o anel
    // acende. vWhite carrega essa proporção, já calculada no vértice.
    if (vRegion > 3.5 && vRegion < 5.5) col = mix(uColorIris, vec3(0.95, 0.98, 1.0), vWhite);
    else if (vRegion > 0.5 && vRegion < 1.5) col = vec3(0.95, 0.98, 1.0);         // esclera
    else if (vRegion > 1.5 && vRegion < 2.5) col = mix(col, uColorAccent, 0.3);   // lábios

    float alpha = a * vAlpha;
    if (alpha < 0.004) discard;

    // O piso de 0.5 dá corpo à pele, mas no olho ele acenderia o vazio entre
    // os anéis — ali a cor acompanha o brilho puro.
    float lift = (vRegion > 3.5 && vRegion < 5.5) ? 0.0 : 0.5;
    gl_FragColor = vec4(col * (lift + vBright), alpha);
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
