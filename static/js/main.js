let dataTable = null;

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
    linecolor: "#232C36"
};

function plotlyLayout(color){
    return {
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { family: "IBM Plex Mono, monospace", color: "#8494A3", size: 11 },
        margin: { t: 10, r: 20, b: 40, l: 55 },
        xaxis: { ...AXIS_STYLE, type: "date" },
        yaxis: AXIS_STYLE,
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
        hide("graphCardA");
        hide("graphCardB");
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
        hide("graphCardA");
        hide("graphCardB");
        hide("selectedStatsCard");
        return;
    }

    const seriesA = result.series.find(s => s.side === "a");
    const seriesB = result.series.find(s => s.side === "b");

    plotSingleTrace("graphCardA", "graphA", seriesA, result.time, CHANNEL_A_COLOR);
    plotSingleTrace("graphCardB", "graphB", seriesB, result.time, CHANNEL_B_COLOR);

    renderChannelStats(result.statistics, result.comparison);

}

function plotSingleTrace(cardId, graphId, series, time, color){

    if (!series) {
        hide(cardId);
        return;
    }

    show(cardId);

    Plotly.newPlot(graphId, [{
        x: time,
        y: series.values,
        mode: "lines",
        type: "scatter",
        name: series.name,
        line: { color: color, width: 1.6 }
    }], plotlyLayout(color), {
        responsive: true,
        scrollZoom: true,
        displaylogo: false
    });

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

        let comparisonCell = '<span class="cell-note">select both channels</span>';

        if (comparison) {

            if (comparison.overlap_points === 0) {
                comparisonCell = '<span class="cell-note">no overlapping timestamps</span>';
            } else {
                // Each row shows the diff from its own point of view:
                // A's row = mean(A − B), B's row = mean(B − A).
                const raw = s.side === "a"
                    ? comparison.mean_diff
                    : (comparison.mean_diff === null ? null : -comparison.mean_diff);

                const other = s.side === "a" ? "B" : "A";

                comparisonCell = `
                    ${formatDiff(raw)}
                    <span class="cell-note">vs ${other} · avg |Δ| ${comparison.mean_abs_diff.toFixed(4)} · n=${comparison.overlap_points}</span>
                `;
            }
        }

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
