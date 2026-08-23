import assert from "node:assert/strict";

const defaultOrder = ["calendar", "spotify", "weather", "aircraft", "codex", "terminal"];
const defaultSizes = {
  calendar: "wide",
  spotify: "half",
  weather: "half",
  aircraft: "tall",
  codex: "tall",
  terminal: "tall",
};

function cleanWidgetStacks(stacks = [], visible) {
  const visibleSet = new Set(visible);
  const used = new Set();
  return stacks
    .map((stack) => stack.filter((widget) => defaultOrder.includes(widget) && visibleSet.has(widget)))
    .filter((stack) => stack.length === 2)
    .filter((stack) => {
      if (stack.some((widget) => used.has(widget))) {
        return false;
      }
      stack.forEach((widget) => used.add(widget));
      return true;
    });
}

function buildDashboardEntries(layout) {
  const visible = layout.order.filter((widget) => layout.visible.includes(widget));
  const stacks = packWidgetStacks(layout.order, visible, layout.stacks, layout.sizes);
  const stackedWidgets = new Set(stacks.flat());
  const groups = [];

  visible.forEach((widget) => {
    if (stackedWidgets.has(widget)) {
      const stack = stacks.find((pair) => pair.includes(widget));
      if (stack && stack[0] === widget) {
        groups.push(stack);
      }
      return;
    }
    groups.push([widget]);
  });

  const requestedWide = (widget) => layout.sizes?.[widget] === "wide";
  const singleEntry = (widget, size) => ({ widget, size });
  const stackedEntries = (group) => group.map((widget) => ({ widget, size: "half" }));
  const singleWidePair = (groupsToPack) => {
    const wideIndex = groupsToPack.findIndex((group) => group.length === 1 && requestedWide(group[0]));
    const effectiveWideIndex = wideIndex === -1 ? 0 : wideIndex;
    return groupsToPack.map((group, index) => singleEntry(group[0], index === effectiveWideIndex ? "wide" : "tall"));
  };

  if (!groups.length) {
    return [];
  }
  if (groups.length === 1 && groups[0].length === 1) {
    return [singleEntry(groups[0][0], "full")];
  }
  if (groups.length === 1 && groups[0].length === 2) {
    return [
      singleEntry(groups[0][0], "wide"),
      singleEntry(groups[0][1], "tall"),
    ];
  }
  if (groups.length === 2 && groups.every((group) => group.length === 1)) {
    return singleWidePair(groups);
  }
  if (groups.length === 2 && groups.some((group) => group.length === 2) && groups.some((group) => group.length === 1)) {
    return groups.flatMap((group) => (
      group.length === 2
        ? stackedEntries(group)
        : [singleEntry(group[0], "wide")]
    ));
  }

  return groups.flatMap((group) => (
    group.length === 2
      ? stackedEntries(group)
      : [singleEntry(group[0], "tall")]
  ));
}

function packWidgetStacks(order, visible, stacks, sizes = {}) {
  const packed = cleanWidgetStacks(stacks, visible);
  const visibleInOrder = order.filter((widget) => visible.includes(widget));

  if (visibleInOrder.length === 3 && packed.length === 0) {
    const wide = visibleInOrder.filter((widget) => sizes[widget] === "wide");
    const neighbours = visibleInOrder.filter((widget) => widget !== wide[0]);
    if (wide.length === 1 && neighbours.length === 2) packed.push(neighbours);
  }

  while (visibleInOrder.length - packed.length > 3) {
    const stacked = new Set(packed.flat());
    const singles = visibleInOrder.filter((widget) => !stacked.has(widget));
    if (singles.length < 2) break;
    packed.push(singles.slice(-2));
  }

  return packed;
}

function placeWidgetInGrid(layout, dragged, mode) {
  const visible = Array.from(new Set([...layout.visible, dragged])).filter((widget) => defaultOrder.includes(widget));
  const remainingVisible = visible.filter((widget) => widget !== dragged);
  const remainingOrder = layout.order.filter((widget) => widget !== dragged);
  const orderedRemaining = remainingOrder.filter((widget) => remainingVisible.includes(widget));
  const insertIndex = mode === "third-left" ? 0 : mode === "third-right" ? orderedRemaining.length : Math.min(1, orderedRemaining.length);
  const visibleOrder = [
    ...orderedRemaining.slice(0, insertIndex),
    dragged,
    ...orderedRemaining.slice(insertIndex),
  ];
  const sizes = { ...layout.sizes };
  visibleOrder.forEach((widget) => {
    if (widget === dragged) {
      sizes[widget] = mode === "wide-centre" ? "wide" : "tall";
      return;
    }
    sizes[widget] = mode !== "wide-centre" && visibleOrder.length === 2 ? "wide" : "tall";
  });

  return {
    ...layout,
    order: [
      ...visibleOrder,
      ...defaultOrder.filter((widget) => !visibleOrder.includes(widget)),
    ],
    visible: visibleOrder,
    sizes,
    stacks: cleanWidgetStacks(layout.stacks, remainingVisible),
  };
}

function addWidgetToLayout(layout, widget) {
  if (layout.visible.includes(widget)) {
    return layout;
  }
  const visible = [...layout.visible, widget];
  const activeBefore = buildDashboardEntries(layout);
  const stacks = cleanWidgetStacks(layout.stacks, visible);
  const wideEntry = activeBefore.find((entry) => entry.size === "wide");
  const tallEntry = activeBefore.find((entry) => entry.size === "tall");
  if (activeBefore.length === 2 && wideEntry && tallEntry) {
    const pair = [tallEntry.widget, widget];
    return {
      ...layout,
      visible,
      stacks: [...stacks, pair],
    };
  }
  return { ...layout, visible, stacks };
}

function moveWidgetBesideTarget(layout, dragged, target, side) {
  const visible = Array.from(new Set([...layout.visible, dragged, target])).filter((widget) => defaultOrder.includes(widget));
  const remainingVisible = visible.filter((widget) => widget !== dragged);
  const remainingOrder = layout.order.filter((widget) => widget !== dragged);
  const orderedRemaining = remainingOrder.filter((widget) => remainingVisible.includes(widget));
  const targetStack = cleanWidgetStacks(layout.stacks, remainingVisible).find((stack) => stack.includes(target));
  const targetIndexes = targetStack
    ? targetStack.map((widget) => orderedRemaining.indexOf(widget)).filter((index) => index >= 0)
    : [orderedRemaining.indexOf(target)];
  const fallbackIndex = side === "before" ? 0 : orderedRemaining.length;
  const insertIndex = targetIndexes.length
    ? side === "before" ? Math.min(...targetIndexes) : Math.max(...targetIndexes) + 1
    : fallbackIndex;
  const visibleOrder = [
    ...orderedRemaining.slice(0, insertIndex),
    dragged,
    ...orderedRemaining.slice(insertIndex),
  ];
  const sizes = { ...layout.sizes };
  visibleOrder.forEach((widget) => {
    sizes[widget] = "tall";
  });

  return {
    ...layout,
    order: [
      ...visibleOrder,
      ...defaultOrder.filter((widget) => !visibleOrder.includes(widget)),
    ],
    visible: visibleOrder,
    sizes,
    stacks: cleanWidgetStacks(layout.stacks, remainingVisible),
  };
}

function widgetSizeInLayout(layout, widget) {
  return buildDashboardEntries(layout).find((entry) => entry.widget === widget)?.size || defaultSizes[widget];
}

function widgetPreviewFromPointer(layout, target, dragged, xRatio) {
  if (!dragged || dragged === target) {
    return null;
  }
  if (xRatio < 0.26) {
    return { type: "bump", target, side: "before" };
  }
  if (xRatio > 0.74) {
    return { type: "bump", target, side: "after" };
  }
  if (widgetSizeInLayout(layout, target) !== "tall") {
    return null;
  }
  return { type: "split", target, position: "bottom" };
}

const stackedLayout = {
  order: defaultOrder,
  visible: ["calendar", "spotify", "weather"],
  sizes: defaultSizes,
  stacks: [["spotify", "weather"]],
};

assert.deepEqual(
  buildDashboardEntries(stackedLayout),
  [
    { widget: "calendar", size: "wide" },
    { widget: "spotify", size: "half" },
    { widget: "weather", size: "half" },
  ],
  "mock starts with calendar wide and Spotify/Weather sharing a 1/3 column"
);

assert.equal(
  widgetPreviewFromPointer(stackedLayout, "calendar", "calendar", 0.5),
  null,
  "dragging a wide widget over itself does not offer a 2/3 or 1/3 resize preview"
);

assert.equal(
  widgetPreviewFromPointer(stackedLayout, "calendar", "weather", 0.5),
  null,
  "dragging onto the centre of a 2/3 widget does not offer a split preview"
);

assert.equal(
  widgetPreviewFromPointer(stackedLayout, "weather", "calendar", 0.5),
  null,
  "dragging onto a half-height widget does not offer a split preview"
);

const weatherRight = placeWidgetInGrid(stackedLayout, "weather", "third-right");
assert.deepEqual(weatherRight.stacks, [], "dragging a widget onto the grid pulls it out of the stacked column");
assert.deepEqual(
  buildDashboardEntries(weatherRight),
  [
    { widget: "calendar", size: "tall" },
    { widget: "spotify", size: "tall" },
    { widget: "weather", size: "tall" },
  ],
  "right grid drops make the dragged widget a 1/3 full-height widget"
);

const weatherCentre = placeWidgetInGrid(stackedLayout, "weather", "wide-centre");
assert.deepEqual(
  buildDashboardEntries(weatherCentre),
  [
    { widget: "calendar", size: "half" },
    { widget: "spotify", size: "half" },
    { widget: "weather", size: "wide" },
  ],
  "centre grid drops keep the dragged widget wide while stacking its neighbours into the remaining column"
);

const weatherLeft = placeWidgetInGrid(stackedLayout, "weather", "third-left");
assert.equal(buildDashboardEntries(weatherLeft)[0].widget, "weather", "left grid drops move the dragged widget to the left third");
assert.equal(buildDashboardEntries(weatherLeft)[0].size, "tall", "left grid drops keep the dragged widget at 1/3 width");

const threeThirdsLayout = {
  order: defaultOrder,
  visible: ["calendar", "spotify", "weather"],
  sizes: { calendar: "tall", spotify: "tall", weather: "tall", codex: "tall", terminal: "tall" },
  stacks: [],
};

assert.deepEqual(
  widgetPreviewFromPointer(threeThirdsLayout, "weather", "calendar", 0.5),
  { type: "split", target: "weather", position: "bottom" },
  "dragging onto the centre of another full-height 1/3 widget offers a split preview"
);

const calendarAfterWeather = moveWidgetBesideTarget(threeThirdsLayout, "calendar", "weather", "after");
assert.deepEqual(
  buildDashboardEntries(calendarAfterWeather),
  [
    { widget: "spotify", size: "tall" },
    { widget: "weather", size: "tall" },
    { widget: "calendar", size: "tall" },
  ],
  "dragging the far-left 1/3 widget after the far-right widget bumps neighbours left"
);

const calendarBeforeWeather = moveWidgetBesideTarget(threeThirdsLayout, "calendar", "weather", "before");
assert.deepEqual(
  buildDashboardEntries(calendarBeforeWeather),
  [
    { widget: "spotify", size: "tall" },
    { widget: "calendar", size: "tall" },
    { widget: "weather", size: "tall" },
  ],
  "dropping before a target inserts the dragged widget and bumps the target right"
);

const weatherBeforeCalendar = moveWidgetBesideTarget(stackedLayout, "weather", "calendar", "before");
assert.deepEqual(weatherBeforeCalendar.stacks, [], "bumping out of a stacked column removes the dragged widget from its stack");
assert.deepEqual(
  buildDashboardEntries(weatherBeforeCalendar),
  [
    { widget: "weather", size: "tall" },
    { widget: "calendar", size: "tall" },
    { widget: "spotify", size: "tall" },
  ],
  "a stacked widget can be bumped into a normal 1/3 position"
);

const afterRemovingOneThird = {
  order: defaultOrder,
  visible: ["spotify", "weather"],
  sizes: { calendar: "tall", spotify: "tall", weather: "tall", codex: "tall", terminal: "tall" },
  stacks: [],
};
assert.deepEqual(
  buildDashboardEntries(afterRemovingOneThird),
  [
    { widget: "spotify", size: "wide" },
    { widget: "weather", size: "tall" },
  ],
  "two remaining 1/3 widgets repack into 2/3 + 1/3 after a removal"
);

const wideAndThird = {
  order: defaultOrder,
  visible: ["calendar", "weather"],
  sizes: { calendar: "wide", spotify: "tall", weather: "tall", codex: "tall", terminal: "tall" },
  stacks: [],
};
const wideAndStackedThird = addWidgetToLayout(wideAndThird, "spotify");
assert.deepEqual(
  buildDashboardEntries(wideAndStackedThird),
  [
    { widget: "calendar", size: "wide" },
    { widget: "weather", size: "half" },
    { widget: "spotify", size: "half" },
  ],
  "adding a widget to a 2/3 plus 1/3 layout stacks it in the existing 1/3 column"
);
assert.deepEqual(
  wideAndStackedThird.stacks,
  [["weather", "spotify"]],
  "adding to a 2/3 plus 1/3 layout preserves the horizontal column stack"
);

const stackOnlyAfterRemoval = {
  order: defaultOrder,
  visible: ["spotify", "weather"],
  sizes: defaultSizes,
  stacks: [["spotify", "weather"]],
};
assert.deepEqual(
  buildDashboardEntries(stackOnlyAfterRemoval),
  [
    { widget: "spotify", size: "wide" },
    { widget: "weather", size: "tall" },
  ],
  "a lone half-height stack expands into full-height widgets when it has empty space"
);

const twoWidgetWideLayout = {
  order: defaultOrder,
  visible: ["calendar", "weather"],
  sizes: { calendar: "wide", spotify: "tall", weather: "tall", codex: "tall", terminal: "tall" },
  stacks: [],
};
const calendarShrunkLeft = placeWidgetInGrid(twoWidgetWideLayout, "calendar", "third-left");
assert.deepEqual(
  buildDashboardEntries(calendarShrunkLeft),
  [
    { widget: "calendar", size: "tall" },
    { widget: "weather", size: "wide" },
  ],
  "shrinking a 2/3 widget to 1/3 expands the neighbour to fill the remaining 2/3"
);

for (const visible of [
  defaultOrder.slice(0, 4),
  defaultOrder.slice(0, 5),
  defaultOrder,
]) {
  const entries = buildDashboardEntries({
    order: defaultOrder,
    visible,
    sizes: defaultSizes,
    stacks: [],
  });
  const occupiedColumns = entries.reduce((total, entry) => total + (entry.size === "wide" ? 2 : entry.size === "full" ? 3 : entry.size === "tall" ? 1 : 0.5), 0);
  assert.equal(occupiedColumns, 3, `${visible.length} widgets stay packed into the three-column dashboard`);
  assert(entries.every((entry) => entry.size !== "wide"), `${visible.length} widgets do not retain a wide span that creates overflow`);
}

console.log("Drag layout mock checks passed");
