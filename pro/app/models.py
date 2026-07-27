from django.db import models

# Create your models here.

class student(models.Model):

    # Personal Information
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    gender = models.CharField(max_length=10)
    date_of_birth = models.DateField()
    age = models.IntegerField()

    # Contact Information
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=15)

    # Address
    address = models.TextField()
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=100)
    country = models.CharField(max_length=100)
    pincode = models.CharField(max_length=10)

    # Extra Details
    blood_group = models.CharField(max_length=5)
    nationality = models.CharField(max_length=50)

    # Account Status
    is_active = models.BooleanField(default=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.first_name} {self.last_name}"
   

