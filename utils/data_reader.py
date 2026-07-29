import os
import pandas as pd


REQUIRED_TIME_COLUMN = "Time"

READERS = {
    ".xlsx": pd.read_excel,
    ".xls": pd.read_excel,
}

# Encodings tried in order for CSV files with no detectable BOM. Historian
# / SCADA trend exports are often written by Windows tools that default to
# the system codepage rather than UTF-8.
FALLBACK_CSV_ENCODINGS = ["utf-8", "cp1252", "latin-1"]


def detect_csv_encoding(path):
    """
    Sniff a byte-order-mark at the start of the file to pick the right
    text encoding. Returns None if no BOM is present, in which case the
    caller should try FALLBACK_CSV_ENCODINGS instead.
    """

    with open(path, "rb") as f:
        head = f.read(4)

    if head.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"

    if head.startswith(b"\xff\xfe") or head.startswith(b"\xfe\xff"):
        # Python's "utf-16" codec auto-detects byte order from the BOM
        # and strips it, so one label covers both LE and BE here.
        return "utf-16"

    return None


def read_csv_smart(path):
    """
    Read a CSV whose encoding is unknown. Tries a BOM-detected encoding
    first, then falls back through common encodings so a file exported by
    a Windows tool (UTF-16, or a legacy codepage with no BOM) doesn't
    simply fail to upload.
    """

    detected = detect_csv_encoding(path)

    encodings_to_try = [detected] if detected else list(FALLBACK_CSV_ENCODINGS)

    last_error = None

    for encoding in encodings_to_try:
        try:
            return pd.read_csv(path, encoding=encoding)
        except (UnicodeDecodeError, UnicodeError) as e:
            last_error = e
            continue

    raise Exception(
        f"Could not determine the text encoding of this CSV file.\n{last_error}"
    )


def load_excel_files(file_paths):
    """
    Read multiple Excel/CSV files and return one merged DataFrame.

    Each file is read with the reader matching its extension
    (.xlsx/.xls via pandas.read_excel, .csv via pandas.read_csv),
    so a single upload batch can freely mix both formats.
    """

    dataframes = []

    for path in file_paths:

        if not os.path.exists(path):
            raise FileNotFoundError(f"{path} not found.")

        extension = os.path.splitext(path)[1].lower()

        if extension == ".csv":

            try:
                df = read_csv_smart(path)
            except Exception as e:
                raise Exception(f"Cannot read {os.path.basename(path)}.\n{e}")

        else:

            reader = READERS.get(extension)

            if reader is None:
                raise Exception(
                    f'"{os.path.basename(path)}" has an unsupported file type '
                    f'"{extension}". Upload .xlsx or .csv files.'
                )

            try:
                df = reader(path)

            except Exception as e:
                raise Exception(f"Cannot read {os.path.basename(path)}.\n{e}")

        validate_dataframe(df, os.path.basename(path))

        df = prepare_dataframe(df)

        dataframes.append(df)

    if not dataframes:
        raise Exception("No valid files found.")

    merged = pd.concat(
        dataframes,
        ignore_index=True
    )

    merged.sort_values(
        REQUIRED_TIME_COLUMN,
        inplace=True
    )

    merged.reset_index(
        drop=True,
        inplace=True
    )

    return merged


def validate_dataframe(df, filename):
    """
    Validate required columns.
    """

    if REQUIRED_TIME_COLUMN not in df.columns:

        raise Exception(
            f'"{filename}" does not contain a "{REQUIRED_TIME_COLUMN}" column.'
        )


def prepare_dataframe(df):
    """
    Convert Time column into datetime and clean data.

    Some plant historian / trend-export CSVs include metadata rows
    (Y-max, Y-min, Unit, Description, ...) directly under the header,
    above the actual timestamped data. Those rows have non-timestamp
    text in the Time column, so coercing Time to datetime turns them
    into NaT, and the dropna() below removes them automatically.
    """

    df = df.copy()

    df[REQUIRED_TIME_COLUMN] = pd.to_datetime(
        df[REQUIRED_TIME_COLUMN],
        errors="coerce",
        format="mixed"
    )

    if df[REQUIRED_TIME_COLUMN].isna().all():
        raise Exception(
            "Unable to parse the Time column."
        )

    df.dropna(
        subset=[REQUIRED_TIME_COLUMN],
        inplace=True
    )

    return df


def get_time_limits(df):
    """
    Returns earliest and latest timestamps
    formatted for HTML datetime-local input.
    """

    minimum = df[REQUIRED_TIME_COLUMN].min()

    maximum = df[REQUIRED_TIME_COLUMN].max()

    return (

        minimum.strftime("%Y-%m-%dT%H:%M:%S"),

        maximum.strftime("%Y-%m-%dT%H:%M:%S")

    )


def filter_dataframe(df, start, end):
    """
    Return rows between selected timestamps.
    """

    start = pd.to_datetime(start)

    end = pd.to_datetime(end)

    filtered = df.loc[
        (df[REQUIRED_TIME_COLUMN] >= start)
        &
        (df[REQUIRED_TIME_COLUMN] <= end)
    ]

    return filtered.reset_index(drop=True)


def dataframe_summary(df):
    """
    Return basic dataset information.
    """

    return {

        "rows": len(df),

        "columns": len(df.columns),

        "start": str(df[REQUIRED_TIME_COLUMN].min()),

        "end": str(df[REQUIRED_TIME_COLUMN].max())

    }


def available_columns(df):
    """
    Return all numeric columns except Time.
    """

    columns = []

    for column in df.columns:

        if column == REQUIRED_TIME_COLUMN:
            continue

        if pd.api.types.is_numeric_dtype(df[column]):
            columns.append(column)

    return columns