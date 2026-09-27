# Pre-Order E-Commerce System

A robust, modern web application designed specifically for handling pre-orders and inventory management. This application provides a public-facing storefront for customers to place pre-orders and a secure administrative dashboard for managing the catalog, orders, and customer data.

## Features

- **Public Storefront**: A sleek, responsive landing page where customers can view available products, read descriptions, and place their pre-orders.
- **Admin Dashboard**: A secure portal (`/butigadmin`) for store owners to manage the entire system.
- **Order Management**: Track orders, update payment statuses (e.g., pending, paid, waiting), and view customer details.
- **Product Catalog**: Add, edit, or remove products and assign them to specific pre-order batches.
- **Batch Management**: Group products into batches to organize when items will arrive and be distributed.
- **Authentication**: Secure login system using Next-Auth to protect the administrative area.

## Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Database**: PostgreSQL (managed via [Prisma ORM](https://www.prisma.io/))
- **Authentication**: [Next-Auth](https://next-auth.js.org/) (v5 Beta)
- **Language**: TypeScript

## Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL Database

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/BDO0/Pre-Order.git
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   Copy `.env.example` to `.env` and update the necessary variables (e.g., `DATABASE_URL`, `AUTH_SECRET`).

4. Run database migrations:
   ```bash
   npm run db:migrate
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000` for the storefront or `http://localhost:3000/butigadmin` for the admin dashboard.

## License

Private Project. All rights reserved.
