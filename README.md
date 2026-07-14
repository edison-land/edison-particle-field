# edison particle field

An interactive Three.js particle identity for **Edison**, an open social connection system where conversations become networks.

Particles enter from the right, assemble into `talk with edison.`, and respond to pointer movement through a pressure-projected velocity field. The interaction supports dense tunnel wakes, circular flow, responsive layouts, and reduced-motion preferences.

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Tuning

The primary controls are near the top of `src/main.js` and inside `createTextTargets()`:

- `INTERACTION_FLOW_SPEED`: pointer-driven flow speed (`0.5` is 50%)
- `maxParticles`: desktop and mobile particle limits
- `lines`: the three-line particle message
- `injectGrid()`: interaction radius and velocity injection

## Stack

- Three.js 0.161.0
- Lenis 1.3.17
- Vite 8.1.4

## Inspiration

The motion study was inspired by [newmixcoffee.com](https://newmixcoffee.com/). This repository contains an independent implementation and does not include the reference site's brand assets, media, or source files.

## License

MIT
