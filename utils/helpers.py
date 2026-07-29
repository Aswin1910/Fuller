import os
import uuid
import pandas as pd

CACHE_FOLDER = "cache"

os.makedirs(CACHE_FOLDER, exist_ok=True)


def generate_cache_name():
    return str(uuid.uuid4()) + ".parquet"


def save_dataframe(df):

    filename = generate_cache_name()

    path = os.path.join(
        CACHE_FOLDER,
        filename
    )

    df.to_parquet(
        path,
        index=False
    )

    return filename


def load_dataframe(filename):

    path = os.path.join(
        CACHE_FOLDER,
        filename
    )

    if not os.path.exists(path):
        raise FileNotFoundError("Cached data not found.")

    return pd.read_parquet(path)


def delete_dataframe(filename):

    path = os.path.join(
        CACHE_FOLDER,
        filename
    )

    if os.path.exists(path):
        os.remove(path)