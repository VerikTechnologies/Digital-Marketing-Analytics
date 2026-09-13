import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || "" });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("vqr_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("vqr_token");
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export default api;
