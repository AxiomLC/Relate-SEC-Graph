// ═══════════════════════════════════════════════════════════
// DEV CONTROLS — THE single source of truth for all visual
// constants in Frontal Lobe.  lucide.dev/icons
//
// CSS consumes these via the CSS-variable bridge in main.jsx.
// The 3D graph reads them directly as JS props.
// (Future theme switcher = swap this object at runtime.)
//
// STRUCTURE (10 Aug 26): uniform per-type tables.
//   graph.nodes.byType = EVERY node type lists the FULL record explicitly —
//     size, color, glow, captionSize, captionColor, nameSize, nameColor,
//     iconSize, iconColor, icon — nothing hidden behind the defaults merge.
//     nodes.defaults is the safety net for FUTURE/unlisted types only.
//   graph.edges.colors = per-edge-type colors + 3-tier width
//   graph.label = global font / icon knobs (per-type overrides live in nodes)
// Node list mirrors schema.py ENTITY_TYPES (+ COGNITION = future Marlowe).
// Edge list mirrors schema.py RELATION_TYPES (MENTIONS is evidence, hidden).
// ═══════════════════════════════════════════════════════════

export const theme = {
  // ------ BASE ------
  colors: {
    bgBase: '#0d0506',    // deep black/red — panel backgrounds (all 4)
    bgHeader: '#161616',  // deep black/gray — header bar
    text: '#f2f2f2',      // white text
    textMuted: '#9a9a9a',
    border: '#b35900',    // thin dark orange — all borders
    glowOrange: '#d97706', // dark orange — header title glow
    accentBlue: '#2b5fd9', // deep blue — AI voice icons + toggles ONLY
  },

  fonts: {
    mono: '"Courier New", Courier, monospace', // header + metadata (medical/spooky)
    body: 'Georgia, "Times New Roman", serif', // narrative / AI text
  },

  header: {
    title: 'Frontal Lobe™', // ™ stays small/raised via CSS
    // dark orange glow behind the title (2x strength)
    glow: '0 0 16px rgba(217, 119, 6, 0.95), 0 0 48px rgba(217, 119, 6, 0.6)',
  },

  // ═══════════════════════════════════════════════════════════
  // 3D GRAPH — the Neural Map. Every visual constant of the map
  // lives here. CAPS sections; comments parked on the right.
  // ═══════════════════════════════════════════════════════════
  graph: {
    // ------ NODES — uniform per-type records + defaults ------
    // EVERY type lists the full record: size · color · glow · captionSize ·
    // captionColor · nameSize · nameColor · iconSize · iconColor · icon.
    nodes: {
      defaults: {
        size: 8,                        // glow-ball size in world units
        color: '#666666',               // node color (fallback gray)
        glow: { opacity: 0.65, featherStart: 0.65 }, // glow ball (0-1)
        captionSize: 12,
        captionColor: '#e2ffe0',
        nameSize: 20,
        nameColor: '#ffffff',
        iconSize: 52,
        iconColor: '#0ba800',
        icon: 'SquareDashed',           // default icon — every type has one (10 Aug 26)
        labelScale: 1.0,                // whole-label size multiplier (10 Aug 26; CONTRACT/DEAL_EVENT/TICKER/PATENT override)
      },
      byType: {
        // TICKER: symbol caption over the canonical name — no tag word.
        TICKER: {
          size: 25, color: '#222222',
          glow: { opacity: 0.95, featherStart: 0.75 },
          captionSize: 26, captionColor: '#d97706',
          nameSize: 30, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#8a8a8a', icon: 'TrendingUp',
          noWrapName: true,
          labelScale: 2.0,              // 16 Aug 26: the top anchor — whole label grows like CONTRACT
        },
        SUBSIDIARY: {
          size: 6, color: '#141414',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 14, nameColor: '#ffffff',
          iconSize: 48, iconColor: '#ffffff', icon: 'HousePlus',
        },
        COMPANY: {
          size: 8, color: '#141414',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 18, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#8a8a8a', icon: 'House',
        },
        PERSON: {
          size: 6, color: '#3b4eff',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 16, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#1d4ed8', icon: 'User',
        },
        CONTRACT: {
          size: 15, color: '#105700',  // orig color #4b2a80 off purple
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 20, captionColor: '#e2ffe0',
          nameSize: 20, nameColor: '#ffffff',
          iconSize: 60, iconColor: '#eab308', icon: 'ScrollText',
          labelScale: 2.0,              // 10 Aug 26: bigger label for the deal anchors
        },
        DEAL_EVENT: {
          size: 15, color: '#0e3d03', // orig color off grey #473563
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 22, captionColor: '#e2ffe0',
          nameSize: 20, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#beffb0', icon: 'Handshake',
          labelScale: 2.3,              // 10 Aug 26: bigger label for the deal anchors
        },
        CONTRACT_TERM: {
          size: 6, color: '#08420e',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 16, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#0ea5e9', icon: 'Scale',
        },
        PRODUCT: {
          size: 7, color: '#2dd4bf',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 16, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#2dd4bf', icon: 'Package',
        },
        TECHNOLOGY: {
          size: 7, color: '#5e0000',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 20, captionColor: '#e2ffe0',
          nameSize: 16, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#14b8a6', icon: 'CircuitBoard',
        },
        IP: {
          size: 7, color: '#7c3aed',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 16, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#a855f7', icon: 'Copyright',
        },
        PATENT: {
          size: 15, color: '#632436',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 16, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#eab308', icon: 'NotebookPen',
          labelScale: 2.0,              // 16 Aug 26: patent anchors read bigger than plain nodes
        },
        // PATENT_INVENTORY — one portfolio node per ticker (USPTO leg, 14 Aug 26;
        // renamed from PATENT_APPS 15 Aug 26). Deep red-purple: between the
        // PATENT purple and the INVENTOR red — the "everything else" family.
        PATENT_INVENTORY: {
          size: 9, color: '#ed6684',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 14, captionColor: '#e2ffe0',
          nameSize: 18, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#a21caf', icon: 'Files',
        },
        TRADEMARK: {
          size: 8, color: '#9333ea',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 16, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#9333ea', icon: 'Stamp',
        },
        INVENTOR: {
          size: 6, color: '#e11d48',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 13, captionColor: '#e2ffe0',
          nameSize: 16, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#7d7d7d', icon: 'User',
        },
        // COGNITION — future Marlowe AI discoveries (confirmed build, 10 Aug 26)
        COGNITION: {
          size: 30, color: '#f5c542',
          glow: { opacity: 0.85, featherStart: 0.75 },
          captionSize: 16, captionColor: '#e2ffe0',
          nameSize: 24, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#f5c542', icon: 'Sparkles',
        },
        // FEDERAL_AWARD — a federal contract/grant award (USASpending leg,
        // 16 Aug 26). Same size as DEAL_EVENT + labelScale (user instruction);
        // green family = "government money". Caption: "DOD · $13.4M".
        FEDERAL_AWARD: {
          size: 15, color: '#166534',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 20, captionColor: '#4ade80',
          nameSize: 20, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#ffffff', icon: 'Landmark',
          labelScale: 1.8,
        },
        // AWARD_INVENTORY — one portfolio node per ticker (USASpending leg,
        // 16 Aug 26). Mirrors PATENT_INVENTORY: everything not featured.
        AWARD_INVENTORY: {
          size: 9, color: '#14532d',
          glow: { opacity: 0.65, featherStart: 0.65 },
          captionSize: 14, captionColor: '#e2ffe0',
          nameSize: 18, nameColor: '#ffffff',
          iconSize: 52, iconColor: '#fce8ae', icon: 'Landmark',
        },
      },
    },

    // ------ LABEL — global font + icon knobs (per-type overrides in nodes) ------
    label: {
      fontFamily: 'Arial, "Georgia", serif',     // Arial first, Georgia fallback
      iconGap: 2,
      iconStrokeWidth: 1.0, // 1.0 = thin stroke
      lineSpacing: 1.5,
      maxWidth: 240,
      captionMaxLines: 2,
      nameMaxLines: 2,
    },

    // - Glow -  general glow shared by all types (per-type glow in nodes)
    glowOthers: {
      spriteScale: 2.8,    // 1.0-3.0 — glow size relative to the label sprite
      featherStart: 0.65,  // 0.01-1.0 where the feathered edge starts (fallback)
      opacity: 0.65,       // 0.01-1.0 general default (fallback)
      depthWrite: true,    // TRUE = glow occludes nodes behind it (solid ball)
      degreeBoost: 0.15,   // glow radius += min(degree,100) × this — hubs (main contracts) grow visibly
    },

    // - Halo -  the selected-node ring (9 Aug 26). Click selects WITHOUT camera
    //   movement; this ring is the only selection feedback. Thin bright orange.
    halo: {
      color: '#ff8c00',    // bright orange ring
      thickness: 1,        // ring line width in px (1-4)
      opacity: 0.9,        // 0.01-1.0 ring alpha
      radiusScale: 1.85,   // ring radius relative to the node glow radius
    },

    // ------ EDGES — per-type colors + 3-tier width ------
    edges: {
      colors: {
        HAS_CONTRACT: '#a8e83a',    // orig: yellow #eab308— the deal edges (core/boldest)
        HAS_DEAL: '#a8e83a',        // orig: amber #f59e0b — announced-deal edges (deal events)
        SUBSIDIARY_OF: '#b45309',   // dark amber — parent → sub
        HAS_TERM: '#26a65d',        // orig: orange #d97706 — contract → money/exclusivity clauses
        COVERS: '#ca8a04',          // dark yellow — contract → product/tech
        GRANTS: '#22c55e',          // green — gives a right/benefit
        RESTRICTS: '#ef4444',       // red — limits (caps, non-compete)
        BUYS: '#3b82f6',            // blue — purchases
        SELLS: '#8b5cf6',           // violet — sells (counterparty view)
        OWNS: '#14b8a6',            // teal — owns (IP, patents, products)
        PLEDGES: '#f97316',         // orange — collateral / security interest
        OBLIGATES: '#eab308',       // yellow — imposes a duty
        INVENTED_BY: '#e11d48',     // red — patent → inventor (USPTO leg)
        LEVERAGES_TECH: '#a855f7',  // purple — patent → technology (USPTO leg)
        HAS_PATENT: '#c026d3',      // fuchsia — owner → patent (USPTO leg)
        HAS_PATENT_INVENTORY: '#a21caf', // deep red-purple — ticker → patent inventory (USPTO leg)
        HAS_AWARD: '#16a34a',       // green — owner → federal award (USASpending leg)
        HAS_AWARD_INVENTORY: '#15803d', // darker green — ticker → award inventory (USASpending leg)
        AWARDED_BY: '#b45309',      // dark amber — award → prime contractor (subaward hook, a3)
      },
      // Width tiers — × log(weight); core = the deal edges
      width: { core: 2.5, normal: 1.4, faint: 1.1 },
    },
    // - Opacity -
    edgeOpacity: 0.45, // 0.01-1.0, default 0.35
    // - Direction -  particles substitute for arrows (the gold thread)
    particles: {
      enabled: true,
      types: ['HAS_CONTRACT', 'HAS_DEAL', 'EVIDENCE_OF'],
      count: 2,       // particles per edge
      speed: 0.004,   // particle travel speed
      color: '#eab308',
    },
    arrows: { enabled: false, length: 4, relPos: 1 }, // native arrowheads (noisy in 3D, off)

    // ------ PHYSICS ------
    physics: {
      charge: -60,          // node repulsion, -30 default, -60 spread
      linkDistance: 70,     // target edge length
      linkDistanceByType: { SUBSIDIARY_OF: 115 }, // push the sub-shell out (no perfect ball)
      centerStrength: 1.0,  // centroid lock — keeps the cluster centered
      axisStrength: 0.04,   // per-node pull toward origin (stops drift)
      alphaDecay: 0.02,     // how fast the sim settles (lower = wider)
      velocityDecay: 0.3,   // friction (0.1 glides, 0.5 stops quick)
      warmupTicks: 100,     // pre-run ticks BEFORE first render (no "one mass" start)
      cooldownTime: 5000,   // ms backstop — engine stops after this if not settled
    },
  },
}

export default theme

// ═══ DEV-CONTROL WORKFLOW (5 Aug 26) ═══
// The 3D scene builds each sprite ONCE per node — hot-reloading theme.js alone
// leaves the old materials on the live sprites. A theme edit therefore forces a
// full page reload so every knob reaches the scene.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload())
}
