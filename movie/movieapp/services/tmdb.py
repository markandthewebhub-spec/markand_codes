import requests
from django.conf import settings

BASE_URL = "https://api.themoviedb.org/3"


def search_movie(movie_name):
    url = f"{BASE_URL}/search/movie"
    params = {
        "api_key": settings.TMDB_API_KEY,
        "query": movie_name,
    }
    response = requests.get(url, params=params)

    if response.status_code == 200:
        return response.json().get("results", [])

    return []


def get_movie_details(tmdb_id):
    url = f"{BASE_URL}/movie/{tmdb_id}"
    params = {
        "api_key": settings.TMDB_API_KEY,
        "append_to_response": "credits,videos",
    }
    response = requests.get(url, params=params)

    if response.status_code != 200:
        return None

    return response.json()


def get_person_details(person_id):
    url = f"{BASE_URL}/person/{person_id}"
    params = {
        "api_key": settings.TMDB_API_KEY,
        "append_to_response": "movie_credits",
    }
    response = requests.get(url, params=params)

    if response.status_code != 200:
        return None

    return response.json()