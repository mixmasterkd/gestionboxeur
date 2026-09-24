/** Shared, fixed SVG drawings: no user content is interpreted as markup. */
export function accessIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const paths = {
    locked: ['M8 10V6a4 4 0 0 1 8 0v4', 'M6 10h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Z', 'M12 14v3'],
    unlocked: ['M8 10V6a4 4 0 0 1 8 0', 'M6 10h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Z', 'M12 14v3'],
    private: ['m3 3 18 18', 'M10.6 10.6a2 2 0 0 0 2.8 2.8', 'M9.6 5.4A12 12 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9', 'M6.2 6.2A20 20 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.1-1.3'],
    shared: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  };
  for (const drawing of paths[name] || paths.unlocked) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', drawing); svg.append(path);
  }
  return svg;
}
