from django.shortcuts import render
from .models import Movie
from .models import Contact
from django.shortcuts import render, get_object_or_404
from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.shortcuts import redirect
from django.contrib.auth.decorators import login_required
from .models import Favorite
from .models import Movie, Contact, Favorite
import re

# Create your views here.

def homepage(request):
    search = request.GET.get("search")
    if search:
        movies = Movie.objects.filter(title__icontains=search)
    else:
        movies = Movie.objects.all()
    return render(request, "homepage.html", {"movies": movies})


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

    is_favorite = False

    if request.user.is_authenticated:
        is_favorite = Favorite.objects.filter(
            user=request.user,
            movie=movie
        ).exists()

    return render(request, "details.html", {
        "movie": movie,
        "cast_list": cast_list,
        "is_favorite": is_favorite,
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

from .services.tmdb import search_movie
from django.http import JsonResponse


def tmdb_test(request):

    movies = search_movie("Avengers")

    return JsonResponse(movies, safe=False)