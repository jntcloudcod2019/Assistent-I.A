/**
 * Shaders da esfera de partículas.
 *
 * A superfície é deslocada por uma soma de ondas esféricas em direções
 * diferentes — não por ruído isotrópico. Ruído puro daria uma casca
 * granulada, tipo couve-flor; ondas cruzadas produzem as cristas e vales
 * longos que dão a leitura de "energia percorrendo a superfície".
 *
 * O brilho vem da crista, não de uma cor por ponto: onde a onda empurra para
 * fora, o ponto acende. É isso que desenha as faixas luminosas sem precisar
 * de textura nem de segunda geometria.
 */

export const SPHERE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;      // amplitude do microfone, 0..1
  uniform float uJaw;        // abertura da fala, 0..1
  uniform float uThinking;   // turbulência de raciocínio, 0..1
  uniform float uReveal;     // materialização no boot, 0..1
  uniform float uSize;
  uniform float uPixelRatio;

  attribute float aSeed;

  varying float vBright;
  varying float vAlpha;
  varying float vRim;

  void main() {
    vec3 dir = normalize(position);

    // Três ondas em eixos distintos e com períodos primos entre si: sem isso
    // elas voltariam a coincidir e o padrão pulsaria inteiro, como uma bola
    // inflando, em vez de ondular.
    float w1 = sin(dir.x * 7.0  + uTime * 0.9);
    float w2 = sin(dir.y * 11.0 - uTime * 1.3);
    float w3 = sin(dir.z * 13.0 + uTime * 0.7);
    float wave = (w1 + w2 + w3) / 3.0;

    // Segunda camada, mais fina e rápida: dá o detalhe de superfície que a
    // onda longa sozinha não tem.
    float ripple = sin(dot(dir, vec3(0.57, 0.57, 0.57)) * 29.0 - uTime * 2.1) * 0.35;

    // A voz empurra a casca para fora; o raciocínio a agita sem inflar.
    float voice = (uLevel * 0.6 + uJaw * 0.9);
    float churn = uThinking * sin(aSeed * 43.0 + uTime * 3.4) * 0.5;

    float displace = (wave + ripple) * (0.055 + voice * 0.09) + churn * 0.03;

    // Respiração de repouso: sem ela a esfera parada parece congelada.
    float breathe = sin(uTime * 0.6) * 0.012;

    vec3 pos = dir * (1.0 + displace + breathe);

    // A materialização sobe do polo sul: os pontos ainda não revelados ficam
    // colapsados no centro, e não espalhados — assim a esfera "se junta".
    float gate = smoothstep(-1.05, 1.05, dir.y);
    float shown = smoothstep(gate - 0.25, gate + 0.05, uReveal);
    pos = mix(vec3(0.0), pos, shown);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // Crista acesa, vale apagado — a fonte de todo o desenho luminoso.
    vBright = smoothstep(-0.4, 1.0, wave + ripple * 0.6) * (0.55 + voice * 0.8);

    // Silhueta: pontos de perfil brilham mais, o que dá volume ao que é só
    // uma casca de pontos. O mv.xyz normalizado aponta da câmera ao ponto.
    vRim = 1.0 - abs(dot(dir, normalize(-mv.xyz)));

    vAlpha = shown * (0.25 + vBright * 0.75);

    // Tamanho com atenuação de perspectiva; a variação por semente evita a
    // regularidade de grade, que leria como malha e não como nuvem.
    float size = uSize * (0.65 + aSeed * 0.7) * (1.0 + vBright * 0.9);
    gl_PointSize = size * uPixelRatio * (1.0 / -mv.z);
  }
`

export const SPHERE_FRAG = /* glsl */ `
  precision mediump float;

  uniform vec3 uColorDeep;   // azul profundo — o vale da onda
  uniform vec3 uColorMid;    // ciano — a subida
  uniform vec3 uColorHot;    // amarelo fluorescente — a crista

  varying float vBright;
  varying float vAlpha;
  varying float vRim;

  void main() {
    // Ponto redondo com borda suave. Quadrados seriam visíveis na densidade
    // alta e a nuvem viraria uma trama.
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25) discard;
    float falloff = 1.0 - smoothstep(0.0, 0.25, r);

    // Gradiente em três paradas ao longo da onda: azul no vale, ciano na
    // subida, amarelo na crista. Como vBright vem do deslocamento, a
    // transição de cor percorre a superfície junto com a ondulação — é isso
    // que faz o amarelo parecer energia correndo, e não uma tinta parada.
    float t = clamp(vBright, 0.0, 1.0);
    vec3 col = mix(uColorDeep, uColorMid, smoothstep(0.0, 0.55, t));
    float hot = smoothstep(0.55, 1.0, t);
    col = mix(col, uColorHot, hot);

    // A silhueta puxa para o ciano, não para o amarelo: com a borda inteira
    // amarela a esfera perderia o contorno frio que a liga ao resto da cena.
    col = mix(col, uColorMid, pow(vRim, 3.0) * 0.45 * (1.0 - hot));

    // Teto de brilho, e mais apertado onde o amarelo domina. Com blending
    // aditivo um canal já em 1.0 estoura para branco a qualquer ganho — e o
    // verde do #e8ff0a JÁ está em 1.0, então sem este freio a crista viraria
    // uma mancha branca exatamente onde a cor deveria aparecer.
    float ceiling = mix(1.6, 1.05, hot);
    float gain = min(0.35 + t * 1.15 + vRim * 0.35, ceiling);

    gl_FragColor = vec4(col * gain, vAlpha * falloff);
  }
`
