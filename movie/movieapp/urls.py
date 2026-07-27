from django.urls import path
from . import views

urlpatterns = [

    path("", views.homepage, name="homepage"),

    path("about/", views.about, name="about"),

    path("contact/", views.contact_view, name="contact"),

    path('genres/', views.genres, name='genres'),

    path("explore/", views.explore, name="explore"),

    path("movie/<str:title>/", views.movie_details, name="movie_details"),

    path('genre/<str:genre>/', views.genre_movies, name='genre_movies'),

    path("login/", views.user_login, name="login"),

    path("register/", views.register, name="register"),

    path("logout/", views.user_logout, name="logout"),

    path("favorite/add/<str:title>/", views.add_favorite, name="add_favorite"),

    path("favorite/remove/<str:title>/", views.remove_favorite, name="remove_favorite"),

    path("favorites/", views.favorites, name="favorites"),

    path("tmdb-test/", views.tmdb_test, name="tmdb_test"),

    path("add-from-tmdb/<int:tmdb_id>/", views.add_from_tmdb, name="add_from_tmdb"),

    path("actor/<int:person_id>/", views.actor_details, name="actor_details"),

]