from django.shortcuts import render, HttpResponse
from .models import student


# Create your views here.

def info(request):

    if request.method == "POST":

        student.objects.create(

            # Personal Information
            first_name=request.POST["first_name"],
            last_name=request.POST["last_name"],
            gender=request.POST["gender"],
            date_of_birth=request.POST["date_of_birth"],
            age=request.POST["age"],

            # Contact Information
            email=request.POST["email"],
            phone=request.POST["phone"],

            # Address
            address=request.POST["address"],
            city=request.POST["city"],
            state=request.POST["state"],
            country=request.POST["country"],
            pincode=request.POST["pincode"],

            # Extra Details
            blood_group=request.POST["blood_group"],
            nationality=request.POST["nationality"],

            # Account Status
            is_active = request.POST.get("is_active") == "on"

        )

    return render(request, "homepage.html")


def show(request):

    students = student.objects.all()

    return render(request, "database.html", {"students": students})









