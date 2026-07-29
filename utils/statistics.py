import math
import pandas as pd
import numpy as np


def safe_round(value, digits=4):
    """
    Round a numpy/pandas value to a plain Python float, returning None
    for NaN/Inf instead of leaving them in (NaN isn't valid JSON and
    reads poorly in an HTML table).
    """

    try:
        value = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(value):
        return None

    return round(value, digits)


def numeric_columns(df):
    """
    Return column names (excluding Time) that contain at least one
    genuinely numeric value once coerced.

    This intentionally does NOT require the column's pandas dtype to
    already be numeric: CSV exports (especially ones with stray
    metadata/description rows mixed into the data, like plant historian
    trend exports) are frequently read in as text even though the
    values themselves are numbers. A strict dtype check would exclude
    those columns entirely and silently produce an empty statistics
    table.
    """

    cols = []

    for col in df.columns:

        if col.lower() == "time":
            continue

        if pd.to_numeric(df[col], errors="coerce").notna().any():
            cols.append(col)

    return cols


def calculate_statistics(df):
    """
    Calculate statistics for every numeric-ish column.
    """

    columns = numeric_columns(df)

    rows = []

    for col in columns:

        s = pd.to_numeric(df[col], errors="coerce")

        rows.append({

            "Column": col,

            "Count": int(s.count()),

            "Missing": int(s.isna().sum()),

            "Average": safe_round(s.mean()),

            "Std Dev": safe_round(s.std()),

            "Median": safe_round(s.median()),

            "Minimum": safe_round(s.min()),

            "Maximum": safe_round(s.max())

        })

    return pd.DataFrame(rows)


def summary_statistics(df):
    """
    General dataset summary.
    """

    return {

        "Rows": len(df),

        "Columns": len(df.columns),

        "Numeric Columns": len(numeric_columns(df)),

        "Missing Cells": int(df.isna().sum().sum())

    }


def column_statistics(df, column):
    """
    Statistics for one selected column.
    """

    if column not in df.columns:

        raise Exception(f"{column} not found.")

    s = pd.to_numeric(df[column], errors="coerce")

    return {

        "Average": safe_round(s.mean()),

        "Std Dev": safe_round(s.std()),

        "Median": safe_round(s.median()),

        "Minimum": safe_round(s.min()),

        "Maximum": safe_round(s.max()),

        "Count": int(s.count()),

        "Missing": int(s.isna().sum())

    }


def correlation_matrix(df):
    """
    Correlation matrix.
    """

    columns = numeric_columns(df)

    coerced = df[columns].apply(pd.to_numeric, errors="coerce")

    return coerced.corr()


def detect_outliers_iqr(df):
    """
    Count outliers using IQR.
    """

    result = []

    for col in numeric_columns(df):

        s = pd.to_numeric(df[col], errors="coerce")

        q1 = s.quantile(.25)

        q3 = s.quantile(.75)

        iqr = q3 - q1

        lower = q1 - 1.5 * iqr

        upper = q3 + 1.5 * iqr

        outliers = s[
            (s < lower)
            |
            (s > upper)
        ]

        result.append({

            "Column": col,

            "Outliers": int(outliers.count())

        })

    return pd.DataFrame(result)