import requests
from django.conf import settings

BASE_URL = "https://api.themoviedb.org/3"

def search_movie(movie_name):
    print("API KEY:", settings.TMDB_API_KEY)

    url = f"{BASE_URL}/search/movie"

    params = {
        "api_key": settings.TMDB_API_KEY,
        "query": movie_name,
    }

    response = requests.get(url, params=params)

    print("Status:", response.status_code)
    print("Body:", response.text)

    if response.status_code == 200:
        return response.json().get("results", [])

    return []