let dataTable = null;

// -------------------------------
// Range selections (peak picking)
// -------------------------------

let selections = [];
let nextSelectionId = 1;
let selectModeOn = false;

const SELECTION_COLORS = [
    "#9B7EDE", // violet
    "#E5484D", // red
    "#6E9BF5", // blue
    "#D6A2E8", // light purple
    "#6FCF97", // green
    "#F5D76E", // yellow
    "#F783AC", // pink
    "#4DABF7", // sky blue
    "#FF8A65", // coral
    "#A9E34B"  // lime
    // Deliberately excludes amber (#F5A623) and cyan (#4FD6C4) -- those
    // are Channel A's and Channel B's own trace colors, so a selection
    // using either one would visually blend into the line instead of
    // reading as its own distinct highlight.
];

function selectionColor(index){
    return SELECTION_COLORS[index % SELECTION_COLORS.length];
}

const els = {
    loading: () => document.getElementById("loading"),
    dropzone: () => document.getElementById("dropzone"),
    dropzoneMeta: () => document.getElementById("dropzoneMeta"),
    files: () => document.getElementById("files"),
    statusDot: () => document.getElementById("consoleStatus"),
    statusText: () => document.getElementById("statusText"),
};

function show(id){ document.getElementById(id).hidden = false; }
function hide(id){ document.getElementById(id).hidden = true; }

function setStatus(live, text){
    const bar = els.statusDot();
    els.statusText().textContent = text;
    bar.classList.toggle("is-live", live);
}

function markReadoutsLive(live){
    document.querySelectorAll(".readout").forEach(r => r.classList.toggle("is-live", live));
}

// -------------------------------
// Upload Excel/CSV Files
// -------------------------------

document
    .getElementById("uploadForm")
    .addEventListener("submit", uploadFiles);

async function uploadFiles(e) {

    e.preventDefault();

    const files = els.files().files;

    if (files.length === 0) {
        setStatus(false, "SELECT A FILE FIRST");
        return;
    }

    els.loading().hidden = false;
    setStatus(false, "READING FILES…");

    const formData = new FormData();

    for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
    }

    try {

        const response = await fetch("/upload", {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        els.loading().hidden = true;

        if (!result.success) {
            setStatus(false, "LOAD FAILED");
            alert(result.message);
            return;
        }

        updateSummary(result);
        showTable(result.preview);
        initializeTimePicker(result);
        initializeColumnSelector(result.plant_columns);

        setStatus(true, `${result.rows.toLocaleString()} ROWS · ${result.columns} COLUMNS`);
        markReadoutsLive(true);

    }

    catch (error) {
        els.loading().hidden = true;
        setStatus(false, "LOAD FAILED");
        alert(error);
    }

}

// -------------------------------
// Dropzone (drag & drop + filename echo)
// -------------------------------

const dropzone = els.dropzone();
const fileInput = els.files();

["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
    });
});

["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
    });
});

dropzone.addEventListener("drop", (e) => {
    const dropped = e.dataTransfer.files;
    if (dropped.length > 0) {
        fileInput.files = dropped;
        describeSelectedFiles();
    }
});

fileInput.addEventListener("change", describeSelectedFiles);

function describeSelectedFiles(){
    const files = fileInput.files;
    const meta = els.dropzoneMeta();

    if (files.length === 0) {
        meta.innerHTML = 'Each file needs a <code>Time</code> column · merges &amp; sorts automatically';
        return;
    }

    if (files.length === 1) {
        meta.textContent = files[0].name;
    } else {
        meta.textContent = `${files.length} files selected`;
    }
}

// -------------------------------
// Summary Readouts
// -------------------------------

function updateSummary(result) {

    document.getElementById("rowCount").textContent =
        result.rows.toLocaleString();

    document.getElementById("columnCount").textContent =
        result.columns;

    document.getElementById("startDisplay").textContent =
        result.min_time.replace("T", " ");

    document.getElementById("endDisplay").textContent =
        result.max_time.replace("T", " ");

}

// -------------------------------
// Time Picker
// -------------------------------

function initializeTimePicker(result) {

    const start = document.getElementById("start");
    const end = document.getElementById("end");

    start.min = result.min_time;
    start.max = result.max_time;

    end.min = result.min_time;
    end.max = result.max_time;

    start.value = result.min_time;
    end.value = result.max_time;

    show("filterCard");

}

// -------------------------------
// Filter
// -------------------------------

document
    .getElementById("filterForm")
    .addEventListener("submit", applyFilter);

async function applyFilter(e) {

    e.preventDefault();

    const form = new FormData();

    form.append("start", document.getElementById("start").value);
    form.append("end", document.getElementById("end").value);

    const response = await fetch("/filter", {
        method: "POST",
        body: form
    });

    const result = await response.json();

    if (!result.success) {
        alert(result.message);
        return;
    }

    document.getElementById("rowCount").textContent =
        result.rows.toLocaleString();

    showTable(result.table);
    loadStatistics();
    loadGraph();
}

// -------------------------------
// DataTable
// -------------------------------

function showTable(html) {

    show("tableCard");

    document.getElementById("tableArea").innerHTML = html;

    const table = document.querySelector("#tableArea table");
    table.id = "excelTable";

    if (dataTable !== null) {
        dataTable.destroy();
    }

    dataTable = new DataTable("#excelTable", {
        pageLength: 25,
        responsive: true,
        searching: true,
        ordering: true,
        lengthMenu: [
            [10, 25, 50, 100],
            [10, 25, 50, 100]
        ]
    });

}

// -------------------------------
// Full statistics table
// -------------------------------

async function loadStatistics(){

    const form = new FormData();

    form.append("start", document.getElementById("start").value);
    form.append("end", document.getElementById("end").value);

    const response = await fetch("/statistics", {
        method: "POST",
        body: form
    });

    const result = await response.json();

    if (!result.success) return;

    show("statsCard");

    document.getElementById("statsArea").innerHTML = result.table;

}

// -------------------------------
// Channel A / Channel B selectors (single plant each)
// -------------------------------

let selectorA = null;
let selectorB = null;

function initializeColumnSelector(columns) {

    selectorA = buildSingleSelector("channelASelect", columns, selectorA);
    selectorB = buildSingleSelector("channelBSelect", columns, selectorB);

    selectorA.on("change", () => setTimeout(loadGraph, 100));
    selectorB.on("change", () => setTimeout(loadGraph, 100));

}

function buildSingleSelector(elementId, columns, existingInstance) {

    const select = document.getElementById(elementId);
    select.innerHTML = "";

    columns.forEach(column => {
        const option = document.createElement("option");
        option.value = column;
        option.text = column;
        select.appendChild(option);
    });

    if (existingInstance) {
        existingInstance.destroy();
    }

    return new TomSelect(`#${elementId}`, {
        maxItems: 1,
        maxOptions: columns.length,
        placeholder: "Search and select a plant…",
        create: false,
        closeAfterSelect: true
    });

}

// -------------------------------
// Graph + comparison readout
// -------------------------------

const CHANNEL_A_COLOR = "#F5A623"; // amber
const CHANNEL_B_COLOR = "#4FD6C4"; // cyan

const AXIS_STYLE = {
    fixedrange: false,
    autorange: true,
    gridcolor: "#232C36",
    zerolinecolor: "#232C36",
    linecolor: "#232C36",
    showticklabels: true
};

function plotlyLayout(){
    return {
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { family: "IBM Plex Mono, monospace", color: "#8494A3", size: 11 },
        margin: { t: 10, r: 20, b: 40, l: 55 },
        xaxis: {
            ...AXIS_STYLE,
            type: "date",
            tickformat: "%d-%b",
            tickmode: "linear",
            dtick: 24 * 60 * 60 * 1000, // one label every day
            tickangle: -45
        },
        yaxis: {
            ...AXIS_STYLE,
            // "auto" lets Plotly pick a sensible number of evenly spaced
            // labels for whatever range the data actually spans, instead
            // of a fixed 1-unit step that produces hundreds of cramped
            // labels once values run into the hundreds/thousands.
            tickmode: "auto",
            nticks: 8
        },
        // Drag pans the view. Scroll wheel still zooms (scrollZoom below).
        // Box-select zoom + scrollZoom together on a date axis is what was
        // causing zoom to snap the range down toward the Unix epoch
        // (1970) -- removing the box-zoom drag interaction avoids it.
        dragmode: "pan",
        hovermode: "closest",
        showlegend: false
    };
}

async function loadGraph(){

    const columnA = selectorA ? selectorA.getValue() : "";
    const columnB = selectorB ? selectorB.getValue() : "";

    if (!columnA && !columnB) {
        hide("graphCard");
        hide("selectedStatsCard");
        return;
    }

    const form = new FormData();

    form.append("start", document.getElementById("start").value);
    form.append("end", document.getElementById("end").value);

    if (columnA) form.append("column_a", columnA);
    if (columnB) form.append("column_b", columnB);

    const response = await fetch("/graph", {
        method: "POST",
        body: form
    });

    const result = await response.json();

    if (!result.success) {
        hide("graphCard");
        hide("selectedStatsCard");
        return;
    }

    const seriesA = result.series.find(s => s.side === "a");
    const seriesB = result.series.find(s => s.side === "b");

    plotCombinedTrace(seriesA, seriesB, result.time);

    renderChannelStats(result.statistics, result.comparison);

}

function plotCombinedTrace(seriesA, seriesB, time){

    if (!seriesA && !seriesB) {
        hide("graphCard");
        return;
    }

    show("graphCard");

    const traces = [];

    if (seriesA) {
        traces.push({
            x: time,
            y: seriesA.values,
            mode: "lines",
            type: "scatter",
            name: `A · ${seriesA.name}`,
            line: { color: CHANNEL_A_COLOR, width: 1.6 }
        });
    }

    if (seriesB) {
        traces.push({
            x: time,
            y: seriesB.values,
            mode: "lines",
            type: "scatter",
            name: `B · ${seriesB.name}`,
            line: { color: CHANNEL_B_COLOR, width: 1.6 }
        });
    }

    const layout = plotlyLayout();
    layout.showlegend = true;
    layout.legend = {
        orientation: "h",
        x: 0,
        y: 1.08,
        font: { color: "#8494A3", size: 11 }
    };
    layout.margin = { t: 40, r: 20, b: 45, l: 60 };

    layout.dragmode = selectModeOn ? "select" : "pan";
    layout.selectdirection = "h";
    layout.shapes = selectionShapes();

    // Plotly applies this style to whichever shape is actively being
    // dragged/resized, regardless of that shape's own fillcolor -- its
    // default is a hardcoded magenta (rgb(255,0,255), opacity 0.5),
    // which is why the box visibly changed color the moment you started
    // extending it. Matching it to the theme keeps the highlight subtle
    // and consistent instead of jarring.
    // Plotly applies this style to whichever shape is actively being
    // dragged/resized, regardless of that shape's own fillcolor. Amber
    // is also Channel A's own trace color, so using it here made the
    // line disappear into the highlight while editing -- a neutral
    // white reads as a clear "active" indicator against either channel
    // color without competing with them.
    layout.activeshape = {
        fillcolor: "#FFFFFF",
        opacity: 0.16
    };

    Plotly.newPlot("graph", traces, layout, {
        responsive: true,
        scrollZoom: true,
        displaylogo: false
    }).then(() => {
        // The panel goes from hidden -> visible in the same tick this
        // runs, so Plotly can measure the container before the browser
        // has finished laying it out at full size. That stale/zero-ish
        // initial measurement is what caused most tick labels to never
        // render (only the first couple, drawn before the mismatch
        // mattered). Forcing a resize on the next frame, once layout has
        // definitely settled, fixes it.
        requestAnimationFrame(() => {
            Plotly.Plots.resize("graph");
        });

        // Plotly.newPlot rebuilds the plot's internal event registry each
        // time, so any prior listener from an earlier render is gone --
        // this has to be re-attached after every render, not just once.
        const graphDiv = document.getElementById("graph");
        graphDiv.removeAllListeners && graphDiv.removeAllListeners("plotly_selected");
        graphDiv.removeAllListeners && graphDiv.removeAllListeners("plotly_relayout");
        graphDiv.on("plotly_selected", handleGraphSelection);
        graphDiv.on("plotly_relayout", handleShapeEdit);
    });

}

// -------------------------------
// Selection mode toggle
// -------------------------------

const selectModeBtn = document.getElementById("toggleSelectMode");

selectModeBtn.addEventListener("click", () => {
    selectModeOn = !selectModeOn;
    selectModeBtn.classList.toggle("is-active", selectModeOn);
    selectModeBtn.textContent = selectModeOn ? "Selecting…" : "Select ranges";

    const graphDiv = document.getElementById("graph");
    if (graphDiv && graphDiv.data) {
        Plotly.relayout("graph", {
            dragmode: selectModeOn ? "select" : "pan"
        });
    }
});

document.getElementById("clearSelections").addEventListener("click", () => {
    selections = [];
    refreshSelections();
});

let pendingSelection = null;
let selectionDebounceTimer = null;

function handleGraphSelection(eventData){

    if (!selectModeOn || !eventData || !eventData.range || !eventData.range.x) {
        return;
    }

    const [x0, x1] = eventData.range.x;

    // Plotly fires plotly_selected repeatedly while a box-select drag is
    // still in progress, not just once when you let go -- the same
    // continuous-firing behavior that plotly_relayout has for shape
    // edits. Without debouncing this, a single drag gesture was pushing
    // dozens of near-duplicate selections (each capturing a slightly
    // different in-progress x0/x1) into the list. Keep only the latest
    // range from the current gesture and commit just that one, once the
    // drag settles.
    pendingSelection = { start: toIsoLocal(x0), end: toIsoLocal(x1) };

    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(() => {

        if (!pendingSelection) return;

        selections.push({
            id: nextSelectionId++,
            start: pendingSelection.start,
            end: pendingSelection.end
        });

        pendingSelection = null;
        refreshSelections();

    }, 250);
}

let shapeEditDebounceTimer = null;

function handleShapeEdit(eventData){

    if (!eventData) return;

    // Plotly reports an edited shape as flat keys like "shapes[2].x0" on
    // the relayout event -- this also fires for ordinary pan/zoom
    // (with keys like "xaxis.range[0]"), so only react when a shape
    // actually moved.
    const touchedIndexes = new Set();

    Object.keys(eventData).forEach(key => {
        const match = key.match(/^shapes\[(\d+)\]\.(x0|x1)$/);
        if (match) touchedIndexes.add(Number(match[1]));
    });

    if (touchedIndexes.size === 0) return;

    const graphDiv = document.getElementById("graph");
    const currentShapes = (graphDiv.layout && graphDiv.layout.shapes) || [];

    let changed = false;

    touchedIndexes.forEach(i => {

        const shape = currentShapes[i];
        const selection = selections[i];

        if (!shape || !selection) return;

        let start = toIsoLocal(shape.x0);
        let end = toIsoLocal(shape.x1);

        // If the left edge got dragged past the right edge (or vice
        // versa), keep start/end in the right order rather than saving
        // an inverted range.
        if (start > end) {
            [start, end] = [end, start];
        }

        // Skip if this doesn't actually change anything. Without this,
        // the shape re-sync at the bottom of this function (which
        // itself triggers one more relayout event) would re-enter here
        // and set changed=true again indefinitely.
        if (start === selection.start && end === selection.end) {
            return;
        }

        selection.start = start;
        selection.end = end;
        changed = true;

    });

    if (!changed) return;

    // The chip labels are cheap to update, so keep those live for
    // responsive feedback while dragging. The stats recalculation is
    // NOT cheap -- it's a network round trip that recomputes real
    // statistics server-side -- and Plotly fires this relayout event on
    // every intermediate mouse movement while a shape edge is being
    // dragged, not just once when you let go. Without debouncing this,
    // a couple of seconds of dragging fires dozens of overlapping
    // fetch() calls, which is what was causing the page to hang.
    renderSelectionChips();

    clearTimeout(shapeEditDebounceTimer);
    shapeEditDebounceTimer = setTimeout(() => {

        loadRangeStatistics();

        // Plotly's interactive shape editor doesn't reliably preserve
        // our custom fillcolor/line color through a drag -- it can
        // revert an edited shape to its own internal default styling
        // once the drag completes, which is why the box appeared to
        // change to a different color after extending it. Re-applying
        // our full shapes array (the same selections + selectionColor
        // mapping used everywhere else) restores the correct original
        // color. This only runs once the drag has settled, and the
        // no-op guard above stops it from looping.
        const graphDiv = document.getElementById("graph");
        if (graphDiv && graphDiv.data) {
            try {
                Plotly.relayout("graph", { shapes: selectionShapes() });
            } catch (error) {
                console.error("Failed to re-sync selection shape styling:", error);
            }
        }

    }, 250);

}

function toIsoLocal(value){

    // After you interactively drag a shape's edge, Plotly rewrites that
    // shape's x0/x1 using its own internal numeric representation
    // (milliseconds since epoch) rather than the string we originally
    // supplied. The old code only handled Date objects and strings, so
    // a number here silently fell through to the string branch and got
    // mangled into garbage (e.g. "1752842407000" sliced as if it were
    // a date string) -- that corrupted value would then crash the next
    // Plotly.relayout call the moment a new selection was drawn.
    if (value instanceof Date || typeof value === "number") {

        const date = value instanceof Date ? value : new Date(value);

        // Build the string from local getters (no UTC conversion) so
        // this round-trips consistently with how the string branch
        // below already treats the underlying Time values as
        // timezone-less.
        const pad = n => String(n).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
               `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    // Plotly hands back date-axis selection bounds as plain timestamp
    // strings with no timezone attached (e.g. "2026-07-18 07:10:07") --
    // these are just the raw Time values, not UTC. Round-tripping them
    // through `new Date(...).toISOString()` would reinterpret them in
    // the browser's local timezone and then convert to UTC, silently
    // shifting every boundary (e.g. -5:30 for IST). Just normalize the
    // separator/precision instead of touching the actual time.
    return String(value).replace(" ", "T").slice(0, 19);
}

function selectionShapes(){
    return selections.map((s, i) => ({
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: s.start,
        x1: s.end,
        y0: 0,
        y1: 1,
        fillcolor: selectionColor(i),
        opacity: 0.14,
        line: { color: selectionColor(i), width: 1 },
        // Draw behind the trace lines (Plotly's default is "above",
        // which was covering the line with the highlight fill and
        // making it hard to see, especially while editing).
        layer: "below",
        // Lets the user click the rectangle and drag its edges directly
        // on the chart to extend/shrink it, instead of only being able
        // to delete and re-draw a whole new selection.
        editable: true
    }));
}

function refreshSelections(){

    const graphDiv = document.getElementById("graph");
    if (graphDiv && graphDiv.data) {
        try {
            Plotly.relayout("graph", { shapes: selectionShapes() });
        } catch (error) {
            console.error("Failed to redraw selection shapes:", error);
        }
    }

    renderSelectionChips();

    if (selections.length === 0) {
        hide("selectionsCard");
        document.getElementById("selectionResults").innerHTML = "";
        return;
    }

    show("selectionsCard");
    loadRangeStatistics();
}

function renderSelectionChips(){

    const container = document.getElementById("selectionChips");

    container.innerHTML = selections.map((s, i) => `
        <span class="chip" style="--chip-color:${selectionColor(i)}">
            <span class="chip__swatch"></span>
            S${i + 1} · ${s.start.replace("T", " ")} → ${s.end.replace("T", " ")}
            <button type="button" class="chip__remove" data-id="${s.id}" aria-label="Remove selection">×</button>
        </span>
    `).join("");

    container.querySelectorAll(".chip__remove").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = Number(btn.dataset.id);
            selections = selections.filter(s => s.id !== id);
            refreshSelections();
        });
    });
}

// -------------------------------
// Per-selection + cumulative statistics
// -------------------------------

async function loadRangeStatistics(){

    const columnA = selectorA ? selectorA.getValue() : "";
    const columnB = selectorB ? selectorB.getValue() : "";

    if (!columnA && !columnB) {
        document.getElementById("selectionResults").innerHTML =
            '<p class="empty-note">Pick Channel A and/or B above to see stats for these selections.</p>';
        return;
    }

    try {

        const response = await fetch("/range_statistics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ranges: selections.map(s => ({ start: s.start, end: s.end })),
                column_a: columnA || null,
                column_b: columnB || null
            })
        });

        const result = await response.json();

        if (!result.success) {
            document.getElementById("selectionResults").innerHTML =
                `<p class="empty-note">${result.message}</p>`;
            return;
        }

        renderRangeStatistics(result.results, result.comparison);

    } catch (error) {
        // A non-JSON response (e.g. a raw 500 error page from the
        // server) would otherwise throw here uncaught. Fail visibly
        // but gracefully instead.
        document.getElementById("selectionResults").innerHTML =
            '<p class="empty-note">Could not calculate statistics for these selections. Try adjusting or removing them.</p>';
    }
}

function statRow(label, s, comparisonHtml){
    if (!s) return "";
    return `
        <tr>
            <td>${label}</td>
            <td class="tabular">${s.count}</td>
            <td class="tabular">${s.missing}</td>
            <td class="tabular">${fmt(s.mean)}</td>
            <td class="tabular">${fmt(s.median)}</td>
            <td class="tabular">${fmt(s.std)}</td>
            <td class="tabular">${fmt(s.min)}</td>
            <td class="tabular">${fmt(s.max)}</td>
            ${comparisonHtml === undefined ? "" : `<td class="tabular">${comparisonHtml}</td>`}
        </tr>
    `;
}

function fmt(v){
    return (v === null || v === undefined) ? "—" : v.toFixed(4);
}

// Shared by the per-selection table and the channel readout table below --
// both show the same "diff from this row's point of view" comparison cell.
function buildComparisonCell(entry, side){
    if (!entry) {
        return '<span class="cell-note">select both channels</span>';
    }

    if (entry.overlap_points === 0) {
        return '<span class="cell-note">no overlapping timestamps</span>';
    }

    // Each row shows the diff from its own point of view:
    // A's row = mean(A − B), B's row = mean(B − A).
    const raw = side === "a"
        ? entry.mean_diff
        : (entry.mean_diff === null ? null : -entry.mean_diff);

    const other = side === "a" ? "B" : "A";

    return `
        ${formatDiff(raw)}
        <span class="cell-note">vs ${other} · avg |Δ| ${entry.mean_abs_diff.toFixed(4)} · n=${entry.overlap_points}</span>
    `;
}

function renderRangeStatistics(results, comparison){

    const sides = [["a", "A"], ["b", "B"]];
    const hasComparison = !!comparison;

    const blocks = sides.map(([key, label]) => {

        const side = results[key];
        if (!side) return "";

        const rangeRows = side.per_range.map((r, i) => {
            const comparisonHtml = hasComparison
                ? buildComparisonCell(comparison.per_range[i], key)
                : undefined;
            return statRow(`S${i + 1} · ${side.column}`, r, comparisonHtml);
        }).join("");

        const cumulativeComparisonHtml = hasComparison
            ? buildComparisonCell(comparison.cumulative, key)
            : undefined;

        const cumulativeRow = statRow(`Cumulative · ${side.column}`, side.cumulative, cumulativeComparisonHtml);

        return `
            <table class="selection-stats-table">
                <thead>
                    <tr>
                        <th>Channel ${label} — Selection</th>
                        <th>Count</th>
                        <th>Missing</th>
                        <th>Mean</th>
                        <th>Median</th>
                        <th>Std Dev</th>
                        <th>Min</th>
                        <th>Max</th>
                        ${hasComparison ? "<th>Comparison</th>" : ""}
                    </tr>
                </thead>
                <tbody>
                    ${rangeRows}
                    <tr class="selection-stats-table__cumulative">${cumulativeRow.replace("<tr>", "").replace("</tr>", "")}</tr>
                </tbody>
            </table>
        `;
    }).join("");

    document.getElementById("selectionResults").innerHTML = blocks;
}

function formatDiff(value){
    if (value === null || value === undefined) return "—";
    const cls = value > 0 ? "diff-pos" : value < 0 ? "diff-neg" : "";
    const sign = value > 0 ? "+" : "";
    return `<span class="${cls}">${sign}${value.toFixed(4)}</span>`;
}

function renderChannelStats(statistics, comparison){

    if (!statistics || statistics.length === 0) {
        hide("selectedStatsCard");
        return;
    }

    const rows = statistics.map(s => {

        const comparisonCell = buildComparisonCell(comparison, s.side);

        return `
            <tr>
                <td>${s.plant} <span class="cell-note">CH ${s.side.toUpperCase()}</span></td>
                <td class="tabular">${s.count}</td>
                <td class="tabular">${s.missing}</td>
                <td class="tabular">${s.mean.toFixed(4)}</td>
                <td class="tabular">${s.median.toFixed(4)}</td>
                <td class="tabular">${s.std.toFixed(4)}</td>
                <td class="tabular">${s.min.toFixed(4)}</td>
                <td class="tabular">${s.max.toFixed(4)}</td>
                <td class="tabular">${comparisonCell}</td>
            </tr>
        `;

    }).join("");

    document.getElementById("selectedStatsArea").innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Plant</th>
                    <th>Count</th>
                    <th>Missing</th>
                    <th>Mean</th>
                    <th>Median</th>
                    <th>Std Dev</th>
                    <th>Min</th>
                    <th>Max</th>
                    <th>Comparison (A − B)</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    show("selectedStatsCard");

}