/* Flow Studio — small SVG graph renderer for the image kit */

(function () {
  const TYPE = {
    agent:     { color: '#4f9cff', icon: '▶', label: 'Агент' },
    exclusive: { color: '#f0a020', icon: '◆', label: 'XOR-шлюз' },
    parallel:  { color: '#b18cff', icon: '⬨', label: 'AND-шлюз' },
    output:    { color: '#3ecf8e', icon: '◉', label: 'Вывод' },
  };
  const NW = 200;
  const NH = 62;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  window.renderGraph = function (host, nodes, edges, opts) {
    opts = opts || {};
    const zoom = opts.zoom == null ? 1 : opts.zoom;
    const ox = opts.ox || 0;
    const oy = opts.oy || 0;
    const w = opts.width || 1200;
    const h = opts.height || 500;
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));

    const defs =
      '<defs>' +
      '<marker id="fs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#66748a"/></marker>' +
      '<filter id="fs-glow" x="-50%" y="-50%" width="200%" height="200%">' +
      '<feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>';

    const edgeSvg = edges.map((e) => {
      const a = byId[e.from], b = byId[e.to];
      if (!a || !b) return '';
      const x1 = a.x + NW, y1 = a.y + NH / 2;
      const x2 = b.x - 3, y2 = b.y + NH / 2;
      const mx = (x1 + x2) / 2;
      const col = e.color || '#66748a';
      const lx = e.labelX == null ? mx : e.labelX;
      const ly = e.labelY == null ? (Math.min(y1, y2) + (y1 === y2 ? -9 : -3)) : e.labelY;
      const lbl = e.label
        ? '<text x="' + lx + '" y="' + ly + '" fill="#f0a020" font-size="9.8" font-weight="550" text-anchor="middle" paint-order="stroke" stroke="#080b10" stroke-width="4" stroke-linejoin="round">' + esc(e.label) + '</text>'
        : '';
      return '<g><path d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" fill="none" stroke="' + col + '" stroke-width="' + (e.width || 1.5) + '" marker-end="url(#fs-arrow)"/>' + lbl + '</g>';
    }).join('');

    const nodeSvg = nodes.map((n) => {
      const t = TYPE[n.type] || TYPE.agent;
      const c = t.color;
      const isGw = n.type === 'exclusive' || n.type === 'parallel';
      const gwCy = n.y + NH / 2;
      const clipId = 'clip-' + n.id;
      const clipX = isGw ? n.x + 76 : n.x + 12;
      const clipW = isGw ? NW - 88 : NW - 24;
      const nameLen = String(n.name || '').length;
      let nameFs = 12.5;
      if (isGw) {
        if (nameLen > 12) nameFs = 11.4;
        if (nameLen > 16) nameFs = 10.6;
      } else {
        if (nameLen > 24) nameFs = 11.6;
        if (nameLen > 30) nameFs = 10.8;
      }
      let inner = '';
      if (isGw) {
        const pts = [
          [n.x + 40, n.y + 5],
          [n.x + 66, gwCy],
          [n.x + 40, n.y + NH - 5],
          [n.x + 14, gwCy],
        ].map((p) => p.join(',')).join(' ');
        inner += '<polygon points="' + pts + '" fill="' + c + '" fill-opacity="0.18" stroke="' + c + '" stroke-width="1.35"/>';
        if (n.type === 'exclusive') {
          inner += '<text x="' + (n.x + 40) + '" y="' + (gwCy + 4) + '" fill="' + c + '" font-size="12" font-weight="800" text-anchor="middle">X</text>';
        } else {
          inner +=
            '<line x1="' + (n.x + 37) + '" y1="' + (gwCy - 7) + '" x2="' + (n.x + 37) + '" y2="' + (gwCy + 7) + '" stroke="' + c + '" stroke-width="1.6"/>' +
            '<line x1="' + (n.x + 43) + '" y1="' + (gwCy - 7) + '" x2="' + (n.x + 43) + '" y2="' + (gwCy + 7) + '" stroke="' + c + '" stroke-width="1.6"/>' +
            '<text x="' + (n.x + 40) + '" y="' + (gwCy + 17) + '" fill="' + c + '" font-size="7" font-weight="800" text-anchor="middle">AND</text>';
        }
      }
      const tx = isGw ? n.x + 80 : n.x + 13;
      const dash = isGw ? ' stroke-dasharray="4 3"' : '';
      return (
        '<g>' +
        '<clipPath id="' + clipId + '"><rect x="' + clipX + '" y="' + (n.y + 12) + '" width="' + clipW + '" height="40"/></clipPath>' +
        '<rect x="' + n.x + '" y="' + n.y + '" width="' + NW + '" height="' + NH + '" rx="13" fill="' + c + '" fill-opacity="0.17" stroke="' + c + '" stroke-width="1.3"' + dash + '/>' +
        inner +
        '<g clip-path="url(#' + clipId + ')">' +
        '<text x="' + tx + '" y="' + (n.y + 26) + '" fill="#d7e0ec" font-size="' + nameFs + '" font-weight="600">' + esc(n.name) + '</text>' +
        '<text x="' + tx + '" y="' + (n.y + 44) + '" fill="' + c + '" font-size="10.5">' + t.icon + ' ' + t.label + '</text>' +
        '</g></g>'
      );
    }).join('');

    host.innerHTML =
      '<svg width="100%" height="100%" style="display:block;overflow:visible">' +
      '<g transform="translate(' + ox + ',' + oy + ') scale(' + zoom + ')">' + defs + edgeSvg + nodeSvg + '</g></svg>';
  };

  window.TYPE = TYPE;
})();
