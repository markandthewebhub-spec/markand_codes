from django.db import models
from django.contrib.auth.models import User

# Create your models here.

class Movie(models.Model):

    # Basic Information
    title = models.CharField(max_length=200)
    tagline = models.CharField(max_length=250, blank=True)
    description = models.TextField()

    # Movie Details
    genre = models.CharField(max_length=100)
    language = models.CharField(max_length=50)
    duration = models.PositiveIntegerField(help_text="Duration in minutes")
    release_date = models.DateField()

    # Ratings
    imdb_rating = models.DecimalField(max_digits=3, decimal_places=1)

    # Media
    poster = models.ImageField(upload_to="posters/",blank=True)
    trailer_url = models.URLField(blank=True)

    # Cast & Crew
    director = models.CharField(max_length=100)
    cast = models.TextField(
        help_text="Example: Shah Rukh Khan, Deepika Padukone"
    )

    # Extra Details
    country = models.CharField(max_length=100)
    certificate = models.CharField(
        max_length=20,
        choices=[
            ("U", "U"),
            ("UA", "UA"),
            ("A", "A"),
        ],
    )

    # Status
    is_trending = models.BooleanField(default=False)
    is_featured = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Movie"
        verbose_name_plural = "Movies"

    def __str__(self):
        return self.title
    
class Contact(models.Model):

    name = models.CharField(max_length=100)
    email = models.EmailField()
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
    
class Favorite(models.Model):
    
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    movie = models.ForeignKey(Movie, on_delete=models.CASCADE)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "movie")

    def __str__(self):
        return f"{self.user.username} - {self.movie.title}"
    
class Cast(models.Model):

    movie = models.ForeignKey(Movie, on_delete=models.CASCADE, related_name="cast_members")
    tmdb_person_id = models.IntegerField()
    name = models.CharField(max_length=200)
    character = models.CharField(max_length=200, blank=True)
    photo_url = models.URLField(blank=True)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"{self.name} in {self.movie.title}"