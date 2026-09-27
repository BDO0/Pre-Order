# Pre-Order Management System

A dedicated platform for managing pre-orders, tracking batches, and processing customer orders seamlessly. This system serves as a central hub where customers can place their pre-orders after discovering items on Instagram, and administrators can oversee the entire workflow from order placement to fulfillment.

## Features

- **Storefront**: A clean, intuitive interface for customers to browse available pre-order items and place their orders.
- **Admin Dashboard**: A secure back-office for administrators to manage products, batches, and view analytics.
- **Order Tracking**: End-to-end tracking of order statuses (Pending, Confirmed, Shipped, etc.) and payment statuses.
- **Batch Management**: Group pre-orders into distinct batches to manage manufacturing and shipping timelines effectively.
- **Audit Logs**: Comprehensive history of all actions taken on orders for transparency and accountability.

## Tech Stack

- **Framework**: Next.js (App Router)
- **Database**: PostgreSQL (managed via Prisma ORM)
- **Styling**: Tailwind CSS
- **Authentication**: NextAuth.js

## Getting Started

1. Clone the repository
2. Run `npm install`
3. Copy `.env.example` to `.env` and fill in your database credentials
4. Run `npx prisma db push` to initialize the database
5. Run `npm run dev` to start the development server

## Deployment

This project is configured to be easily deployed on Vercel. Ensure all environment variables in `.env.example` are configured in your deployment settings.
