from flask import Flask, render_template, request, session, jsonify
import os
import uuid
import math
import pandas as pd
from werkzeug.utils import secure_filename

from utils.statistics import calculate_statistics
from utils.data_reader import (
    load_excel_files,
    get_time_limits,
    filter_dataframe
)
from utils.helpers import (
    save_dataframe,
    load_dataframe
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "excel-analyzer-secret")

app.secret_key = os.environ.get("SECRET_KEY") or os.urandom(32).hex()

UPLOAD_FOLDER = os.path.join(os.getcwd(), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ALLOWED_EXTENSIONS = {"xlsx", "xls", "csv"}
MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25 MB per request

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def safe_float(value):
    """
    Convert a numpy/pandas numeric value to a plain Python float that's
    safe to JSON-encode. NaN/Inf become None (JSON has no literal for
    them; leaving them in would produce invalid JSON the browser can't
    parse).
    """

    try:
        value = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(value):
        return None

    return value


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():

    files = request.files.getlist("files")

    if len(files) == 0:
        return jsonify({
            "success": False,
            "message": "No files uploaded."
        })

    uploaded_files = []

    for file in files:

        if file.filename == "":
            continue

        filename = secure_filename(file.filename)

        if not filename:
            return jsonify({
                "success": False,
                "message": "One of the uploaded files has an invalid name."
            })

        if not allowed_file(filename):
            return jsonify({
                "success": False,
                "message": (
                    f'"{file.filename}" is not a supported file type. '
                    f'Upload .xlsx or .csv files.'
                )
            })

        unique_name = str(uuid.uuid4()) + "_" + filename

        filepath = os.path.join(
            UPLOAD_FOLDER,
            unique_name
        )

        file.save(filepath)

        uploaded_files.append(filepath)

    if not uploaded_files:
        return jsonify({
            "success": False,
            "message": "No valid .xlsx or .csv files were uploaded."
        })

    try:
        df = load_excel_files(uploaded_files)

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        })

    finally:
        # Raw uploads are only needed transiently to build the cached
        # DataFrame; delete them immediately afterwards so uploads/ doesn't
        # accumulate every file ever submitted.
        for filepath in uploaded_files:
            try:
                os.remove(filepath)
            except OSError:
                pass

    filename = save_dataframe(df)

    session["cache_file"] = filename

    min_time, max_time = get_time_limits(df)

    columns = [c for c in df.columns if c != "Time"]

    return jsonify({

        "success": True,

        "min_time": min_time,

        "max_time": max_time,

        "rows": len(df),

        "columns": len(df.columns),

        "plant_columns": columns,

        "preview": df.head(200).to_html(index=False)
    })


@app.route("/filter", methods=["POST"])
def filter_data():

    if "cache_file" not in session:
        return jsonify({
            "success": False,
            "message": "Please upload files first."
        })

    try:
        df = load_dataframe(session["cache_file"])
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "message": "Cached data not found."
        })

    start = request.form.get("start")

    end = request.form.get("end")

    filtered = filter_dataframe(
        df,
        start,
        end
    )

    return jsonify({

        "success": True,

        "rows": len(filtered),

        "table": filtered.to_html(

            classes="table table-bordered table-striped table-hover",

            index=False

        )

    })


@app.route("/summary")
def summary():

    if "cache_file" not in session:
        return jsonify({
            "success": False,
            "message": "No uploaded data found."
        })

    try:
        df = load_dataframe(session["cache_file"])
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "message": "Cached data not found."
        })

    return jsonify({
        "success": True,
        "rows": len(df),
        "columns": len(df.columns),
        "start": str(df["Time"].min()),
        "end": str(df["Time"].max())
    })


@app.route("/statistics", methods=["POST"])
def statistics():

    if "cache_file" not in session:
        return jsonify({
            "success": False,
            "message": "Please upload files first."
        })

    try:
        df = load_dataframe(session["cache_file"])
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "message": "Cached data not found."
        })

    start = request.form.get("start")
    end = request.form.get("end")

    filtered = filter_dataframe(df, start, end)

    stats = calculate_statistics(filtered)

    return jsonify({
        "success": True,
        "table": stats.to_html(
            index=False,
            classes="table table-striped table-bordered table-hover"
        )
    })


@app.route("/graph", methods=["POST"])
def graph():

    if "cache_file" not in session:
        return jsonify({
            "success": False,
            "message": "Please upload files first."
        })

    try:
        df = load_dataframe(session["cache_file"])
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "message": "Cached data not found."
        })

    start = request.form.get("start")
    end = request.form.get("end")

    column_a = request.form.get("column_a") or None
    column_b = request.form.get("column_b") or None

    requested = [
        (side, column) for side, column in (("a", column_a), ("b", column_b))
        if column and column in df.columns
    ]

    if not requested:
        return jsonify({
            "success": False,
            "message": "No valid columns selected."
        })

    filtered = filter_dataframe(df, start, end)

    # Numeric coercion happens once per side and is reused for the series,
    # per-channel stats, and the A/B comparison below.
    numeric_by_side = {}

    series = []
    statistics_out = []

    for side, column in requested:

        numeric = pd.to_numeric(filtered[column], errors="coerce")
        numeric_by_side[side] = numeric

        series.append({
            "side": side,
            "name": column,
            "values": [safe_float(v) for v in numeric]
        })

        statistics_out.append({
            "side": side,
            "plant": column,
            "count": int(numeric.count()),
            "missing": int(numeric.isna().sum()),
            "mean": safe_float(numeric.mean()),
            "median": safe_float(numeric.median()),
            "std": safe_float(numeric.std()),
            "min": safe_float(numeric.min()),
            "max": safe_float(numeric.max())
        })

    comparison = None

    if "a" in numeric_by_side and "b" in numeric_by_side:

        # Align by actual timestamp (not row position): files are
        # concatenated rather than joined, so the same Time value for two
        # different plants can live on two different rows. Group by Time
        # first so each side collapses to one value per timestamp, then
        # let pandas align the two Series on their Time index.
        aligned = pd.DataFrame({
            "Time": filtered["Time"],
            "a": numeric_by_side["a"],
            "b": numeric_by_side["b"]
        }).groupby("Time").mean(numeric_only=True)

        diff = (aligned["a"] - aligned["b"]).dropna()

        comparison = {
            "column_a": column_a,
            "column_b": column_b,
            "overlap_points": int(len(diff)),
            "mean_diff": safe_float(diff.mean()) if len(diff) else None,
            "mean_abs_diff": safe_float(diff.abs().mean()) if len(diff) else None
        }

    return jsonify({
        "success": True,
        "time": filtered["Time"].astype(str).tolist(),
        "series": series,
        "statistics": statistics_out,
        "comparison": comparison
    })


@app.route("/multi_graph", methods=["POST"])
def multi_graph():

    if "cache_file" not in session:
        return jsonify({
            "success": False,
            "message": "Please upload files first."
        })

    try:
        df = load_dataframe(session["cache_file"])
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "message": "Cached data not found."
        })

    payload = request.get_json(silent=True) or {}

    start = payload.get("start")
    end = payload.get("end")
    columns = payload.get("columns") or []

    # Order is preserved (not deduped through a set) so trace order/colors
    # stay stable and match whatever order the plants were picked in.
    requested = [c for c in columns if c and c in df.columns]

    if not requested:
        return jsonify({
            "success": False,
            "message": "Select at least one plant to plot."
        })

    filtered = filter_dataframe(df, start, end)

    # Plotting only -- no per-column statistics computed here, unlike
    # /graph and /range_statistics.
    series = [
        {
            "name": column,
            "values": [
                safe_float(v)
                for v in pd.to_numeric(filtered[column], errors="coerce")
            ]
        }
        for column in requested
    ]

    return jsonify({
        "success": True,
        "time": filtered["Time"].astype(str).tolist(),
        "series": series
    })


@app.route("/range_statistics", methods=["POST"])
def range_statistics():

    if "cache_file" not in session:
        return jsonify({
            "success": False,
            "message": "Please upload files first."
        })

    try:
        df = load_dataframe(session["cache_file"])
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "message": "Cached data not found."
        })

    payload = request.get_json(silent=True) or {}

    ranges = payload.get("ranges") or []

    if not ranges:
        return jsonify({
            "success": False,
            "message": "No selections to analyze."
        })

    column_a = payload.get("column_a") or None
    column_b = payload.get("column_b") or None

    requested = [
        (side, column) for side, column in (("a", column_a), ("b", column_b))
        if column and column in df.columns
    ]

    if not requested:
        return jsonify({
            "success": False,
            "message": "No valid columns selected."
        })

    def stats_from_numeric(numeric):
        return {
            "count": int(numeric.count()),
            "missing": int(numeric.isna().sum()),
            "mean": safe_float(numeric.mean()),
            "median": safe_float(numeric.median()),
            "std": safe_float(numeric.std()),
            "min": safe_float(numeric.min()),
            "max": safe_float(numeric.max())
        }

    def comparison_from_slice(sliced):
        # Same approach as /graph: align by actual Time value (not row
        # position) so each side collapses to one value per timestamp
        # before diffing.
        if not (column_a and column_b and column_a in df.columns and column_b in df.columns):
            return None

        aligned = pd.DataFrame({
            "Time": sliced["Time"],
            "a": pd.to_numeric(sliced[column_a], errors="coerce"),
            "b": pd.to_numeric(sliced[column_b], errors="coerce")
        }).groupby("Time").mean(numeric_only=True)

        diff = (aligned["a"] - aligned["b"]).dropna()

        return {
            "overlap_points": int(len(diff)),
            "mean_diff": safe_float(diff.mean()) if len(diff) else None,
            "mean_abs_diff": safe_float(diff.abs().mean()) if len(diff) else None
        }

    results = {}

    # Slice each range once up front (rather than once per side) so it can
    # be reused both for per-side stats and for the A-vs-B comparison below.
    range_slices = [filter_dataframe(df, r.get("start"), r.get("end")) for r in ranges]
    per_range_comparisons = [comparison_from_slice(sliced) for sliced in range_slices]

    for side, column in requested:

        per_range = []
        # Slices are collected (not stacked) so the cumulative view below
        # can drop rows that fall in more than one selection, rather than
        # counting an overlapping timestamp twice.
        slices = []

        for r, sliced in zip(ranges, range_slices):

            slices.append(sliced[["Time", column]])

            numeric = pd.to_numeric(sliced[column], errors="coerce")

            per_range.append({
                "start": r.get("start"),
                "end": r.get("end"),
                **stats_from_numeric(numeric)
            })

        combined = pd.concat(slices, ignore_index=True)
        combined = combined.drop_duplicates(subset="Time")

        cumulative_numeric = pd.to_numeric(combined[column], errors="coerce")

        results[side] = {
            "column": column,
            "per_range": per_range,
            "cumulative": stats_from_numeric(cumulative_numeric)
        }

    cumulative_comparison = None

    if range_slices:
        cumulative_slice = pd.concat(range_slices, ignore_index=True).drop_duplicates(subset="Time")
        cumulative_comparison = comparison_from_slice(cumulative_slice)

    return jsonify({
        "success": True,
        "results": results,
        "comparison": {
            "column_a": column_a,
            "column_b": column_b,
            "per_range": per_range_comparisons,
            "cumulative": cumulative_comparison
        }
    })


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG", "0") == "1")