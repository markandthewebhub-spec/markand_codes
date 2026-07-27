from django.shortcuts import render,get_object_or_404, redirect
from .models import Movie, Favorite, Cast
from .models import Contact
from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from .services.tmdb import search_movie, get_movie_details, get_person_details
from django.http import JsonResponse
from django.core.files.base import ContentFile
import requests as ext_requests
import re


def homepage(request):
    search = request.GET.get("search")
    tmdb_results = []

    if search:
        movies = Movie.objects.filter(title__icontains=search)
        if not movies.exists():
            tmdb_results = search_movie(search)
    else:
        movies = Movie.objects.all()

    return render(request, "homepage.html", {
        "movies": movies,
        "tmdb_results": tmdb_results,
        "search": search,
    })


def database(request):
    movies = Movie.objects.all()
    return render(request, "database.html", {"movies": movies})


def get_youtube_embed_url(url):
    if not url:
        return None
    match = re.search(r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})", url)
    if match:
        return f"https://www.youtube.com/embed/{match.group(1)}"
    return None


def movie_details(request, title):

    movie = get_object_or_404(Movie, title=title)

    cast_list = [name.strip() for name in movie.cast.split(",") if name.strip()]
    cast_members = movie.cast_members.all()

    is_favorite = False

    if request.user.is_authenticated:
        is_favorite = Favorite.objects.filter(
            user=request.user,
            movie=movie
        ).exists()

    trailer_embed_url = get_youtube_embed_url(movie.trailer_url)

    return render(request, "details.html", {
        "movie": movie,
        "cast_list": cast_list,
        "cast_members": cast_members,
        "is_favorite": is_favorite,
        "trailer_embed_url": trailer_embed_url,
    })


def about(request):
    return render(request, "about.html")


def genres(request):
    all_genres = Movie.objects.values_list("genre", flat=True)
    unique_genres = sorted(set(g.strip().title() for g in all_genres if g))
    return render(request, "genres.html", {"genres": unique_genres})


def genre_movies(request, genre):
    movies = Movie.objects.filter(genre__iexact=genre)
    return render(request, "genre_movies.html", {"movies": movies, "genre": genre})


def contact(request):
    return render(request, "contact.html")


def contact_view(request):
    if request.method == 'POST':
        Contact.objects.create(
            name=request.POST.get('name'),
            email=request.POST.get('email'),
            message=request.POST.get('message')
        )
        messages.success(request, "🎉 Your review has been sent successfully!")
    return render(request, "contact.html")


def explore(request):
    trending_movies = Movie.objects.filter(is_trending=True)
    top_rated_movies = Movie.objects.order_by("-imdb_rating")[:8]
    latest_movies = Movie.objects.order_by("-release_date")[:8]
    context = {
        "trending_movies": trending_movies,
        "top_rated_movies": top_rated_movies,
        "latest_movies": latest_movies,
    }
    return render(request, "explore.html", context)


def register(request):

    if request.method == "POST":

        username = request.POST["username"]
        email = request.POST["email"]
        password = request.POST["password"]
        confirm_password = request.POST["confirm_password"]

        if password != confirm_password:
            messages.error(request, "Passwords do not match.")
            return redirect("register")

        if User.objects.filter(username=username).exists():
            messages.error(request, "Username already exists.")
            return redirect("register")

        User.objects.create_user(
            username=username,
            email=email,
            password=password
        )

        messages.success(request, "Account created successfully. Please login.")
        return redirect("login")

    return render(request, "register.html")


def user_login(request):

    if request.method == "POST":

        username = request.POST["username"]
        password = request.POST["password"]

        user = authenticate(
            request,
            username=username,
            password=password
        )

        if user is not None:
            login(request, user)
            return redirect("homepage")

        messages.error(request, "Invalid username or password.")

    return render(request, "login.html")


def user_logout(request):

    logout(request)
    return redirect("homepage")


@login_required
def add_favorite(request, title):

    movie = get_object_or_404(Movie, title=title)

    Favorite.objects.get_or_create(
        user=request.user,
        movie=movie
    )

    return redirect("movie_details", title=title)


@login_required
def remove_favorite(request, title):

    movie = get_object_or_404(Movie, title=title)

    Favorite.objects.filter(
        user=request.user,
        movie=movie
    ).delete()

    return redirect("movie_details", title=title)


@login_required
def favorites(request):

    favorites = Favorite.objects.filter(user=request.user)

    return render(request, "favorites.html", {
        "favorites": favorites
    })


def tmdb_test(request):

    movies = search_movie("Avengers")

    return JsonResponse(movies, safe=False)


def add_from_tmdb(request, tmdb_id):

    if Movie.objects.filter(title=request.GET.get("title")).exists():
        return redirect("homepage")

    data = get_movie_details(tmdb_id)

    if not data:
        messages.error(request, "Could not fetch movie details.")
        return redirect("homepage")

    director = "Unknown"
    for crew in data.get("credits", {}).get("crew", []):
        if crew.get("job") == "Director":
            director = crew.get("name")
            break

    cast_list = [c["name"] for c in data.get("credits", {}).get("cast", [])[:5]]
    cast = ", ".join(cast_list) if cast_list else "Unknown"

    trailer_url = ""
    videos = data.get("videos", {}).get("results", [])

    for video in videos:
        if video.get("site") == "YouTube" and video.get("type") == "Trailer":
            trailer_url = f"https://www.youtube.com/watch?v={video['key']}"
            break

    if not trailer_url:
        for video in videos:
            if video.get("site") == "YouTube" and video.get("type") == "Teaser":
                trailer_url = f"https://www.youtube.com/watch?v={video['key']}"
                break

    if not trailer_url:
        for video in videos:
            if video.get("site") == "YouTube":
                trailer_url = f"https://www.youtube.com/watch?v={video['key']}"
                break

    release_date = data.get("release_date") or "2000-01-01"

    movie = Movie(
        title=data.get("title", "Untitled"),
        tagline=data.get("tagline", "") or "",
        description=data.get("overview", "") or "No description available.",
        genre=", ".join([g["name"] for g in data.get("genres", [])]) or "Unknown",
        language=data.get("original_language", "en"),
        duration=data.get("runtime") or 90,
        release_date=release_date,
        imdb_rating=round(data.get("vote_average", 0), 1),
        trailer_url=trailer_url,
        director=director,
        cast=cast,
        country=", ".join([c["name"] for c in data.get("production_countries", [])]) or "Unknown",
        certificate="UA",
    )

    poster_path = data.get("poster_path")
    if poster_path:
        poster_url = f"https://image.tmdb.org/t/p/w500{poster_path}"
        poster_response = ext_requests.get(poster_url)
        if poster_response.status_code == 200:
            movie.poster.save(
                f"{data.get('id')}.jpg",
                ContentFile(poster_response.content),
                save=False
            )

    movie.save()

    # Save cast members with photos
    cast_data = data.get("credits", {}).get("cast", [])[:10]

    for index, actor in enumerate(cast_data):
        Cast.objects.create(
            movie=movie,
            tmdb_person_id=actor.get("id"),
            name=actor.get("name", "Unknown"),
            character=actor.get("character", ""),
            photo_url=f"https://image.tmdb.org/t/p/w300{actor.get('profile_path')}" if actor.get("profile_path") else "",
            order=index,
        )

    messages.success(request, f"{movie.title} added successfully!")
    return redirect("movie_details", title=movie.title)


def actor_details(request, person_id):

    data = get_person_details(person_id)

    if not data:
        messages.error(request, "Actor details not found.")
        return redirect("homepage")

    photo_url = ""
    if data.get("profile_path"):
        photo_url = f"https://image.tmdb.org/t/p/w300{data.get('profile_path')}"

    known_movies = sorted(
        data.get("movie_credits", {}).get("cast", []),
        key=lambda m: m.get("popularity", 0),
        reverse=True
    )[:8]

    return render(request, "actor_details.html", {
        "name": data.get("name"),
        "biography": data.get("biography") or "No biography available.",
        "birthday": data.get("birthday"),
        "place_of_birth": data.get("place_of_birth"),
        "photo_url": photo_url,
        "known_movies": known_movies,
    })