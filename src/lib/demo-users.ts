export type Role = "CUSTOMER" | "DRIVER" | "ADMIN";

export const DEMO_USERS = {
  CUSTOMER: {
    id: "4bae3c1f-2dce-4210-bd2d-829f0bf4a7ef",
    name: "Nguyễn Minh Anh",
    email: "khach01@example.com",
  },
  DRIVER: {
    id: "dde73e75-5100-4169-8593-9cf8b9c7df83",
    name: "Trần Quốc Bảo",
    email: "taixe01@example.com",
  },
  ADMIN: {
    id: "admin-demo",
    name: "Quản trị RideFlow",
    email: "admin@rideflow.vn",
  },
} as const;

export function roleHome(role: Role) {
  return `/${role.toLowerCase()}/dashboard`;
}