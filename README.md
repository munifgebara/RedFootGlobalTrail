# 🏁 Rally de Maringá — RedFoot Global Trail

POC de simulador de rally 3D 100% no navegador, ambientado na zona rural de
Maringá-PR: terra roxa, cafezais, ipês rosa e amarelos, sedes de fazenda e a
Catedral no horizonte. Uma especial de ~6 km ("SS1 — Estrada do Café") com
copiloto falando pacenotes em português.

**Jogue agora:** abra o GitHub Pages do repositório (ou rode localmente, abaixo).

## Stack

| Camada | Tecnologia |
|---|---|
| Build | Vite + TypeScript (site 100% estático) |
| Render | three.js **WebGPU** com materiais **TSL** (fallback automático p/ WebGL 2) |
| Física | **cannon-es** — `RaycastVehicle` sobre heightfield do relevo |
| Pós-processo | Bloom (faróis/sol) + vinheta via TSL `PostProcessing` |
| Áudio | WebAudio (motor, cascalho, bipes) + copiloto via `speechSynthesis` pt-BR |

Tudo gerado proceduralmente em tempo de carga: pista (Catmull-Rom), relevo,
talhões de cultura, ~560 árvores, ~1600 pés de café, capim com vento, nuvens
animadas, pacenotes extraídos da curvatura do traçado.

## Controles

- **W / ↑** acelerar · **S / ↓** freio & ré
- **A D / ← →** direção · **ESPAÇO** freio de mão (drift)
- **C** câmera (perseguição / capô / TV) · **R** voltar à pista · **M** som

## Rodando localmente

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # gera docs/ (estático)
npm run preview    # serve o build em http://localhost:4300
```

Dica: acrescente `?webgl` à URL para forçar o backend WebGL 2.

## Publicação no GitHub Pages

O build vai para **`docs/`** com caminhos relativos, então basta:

1. Push para o branch `main`;
2. **Settings → Pages → Deploy from a branch → `main` / `docs`**.

Nenhum workflow ou servidor é necessário — só páginas estáticas.

## Roadmap (ver [IDEAS.md](IDEAS.md))

- 🏃 **Virar um jogo de corrida a pé (cross)**: teclas `1`/`0` alternadas para
  as pernas, avatar de corrida, ainda nos arredores de Maringá.
- 🗺️ **Multi-mapas** em pontos turísticos reais (Maringá-Londrina, Cataratas,
  Grand Canyon, Machu Picchu…), avatares personalizáveis, novas pistas via issues.

---

POC gerada com Claude Code para avaliação de modelos de IA.
