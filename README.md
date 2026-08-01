# 🎬 MovieVerse

A Django-based movie discovery web application powered by the TMDB API. Discover trending movies, search for your favorite titles, explore detailed movie information, manage your favorites, and enjoy a seamless user experience with user authentication.

🌐 **Live Demo:** https://markand.pythonanywhere.com

---

## 🚀 Tech Stack

| Technology | Purpose |
|------------|---------|
| Django | Backend framework for routing, views, models, and authentication |
| SQLite | Database for users, movies, favorites, cast, and contact messages |
| TMDB API | Provides movie search, details, cast, trailers, and actor information |
| HTML, CSS, JavaScript | Frontend templates and user interface |
| PythonAnywhere | Production hosting |
| python-dotenv | Loads environment variables from the `.env` file |
| Requests | Handles HTTP requests to the TMDB API |
| Pillow | Image processing for movie posters |

---

## ⚙️ Local Setup

```bash
cd "C:\Users\khushi\OneDrive\Desktop\the mark\movie_project"

python -m venv venv

.\venv\Scripts\Activate.ps1

pip install -r requirements.txt

copy .env.example .env

# Add your TMDB_API_KEY to the .env file

python manage.py migrate

python manage.py createsuperuser

python manage.py runserver
```

The application will be available at:

```
http://127.0.0.1:8000/
```

---

## ☁️ Deployment (PythonAnywhere)

1. Push the project to GitHub.
2. Create a new web application on PythonAnywhere.
3. Configure the WSGI file:

```
movie.wsgi.application
```

4. Activate the virtual environment and install the project dependencies.

```bash
pip install -r requirements.txt
```

5. Run the following commands:

```bash
python manage.py migrate
python manage.py collectstatic
```

6. Configure Static Files Mapping:

```
URL: /static/
Directory: staticfiles/
```

7. Configure Media Files Mapping:

```
URL: /media/
Directory: media/
```

---

## 🔑 Environment Variables

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | Django secret key |
| `DEBUG` | `True` for development, `False` for production |
| `TMDB_API_KEY` | TMDB API key |

---

## 👨‍💻 Author

**Markand**

Built with ❤️ using Django and TMDB API.