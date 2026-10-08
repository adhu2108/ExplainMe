// Shared Auth Helper Library for ExplainMe

// Get user profile details
async function fetchUserProfile() {
  try {
    const res = await fetch('/api/user/profile', { credentials: 'include' });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data.success ? data : null;
  } catch (err) {
    console.error('Error fetching user profile:', err);
    return null;
  }
}

// Check auth status and handle page redirection
async function checkAuth(requireAuth = true) {
  const profileData = await fetchUserProfile();
  const currentPath = window.location.pathname;
  const isAuthPage = currentPath.includes('login.html') || 
                     currentPath.includes('register.html') || 
                     currentPath.includes('otp-verification.html') || 
                     currentPath.includes('forgot-password.html') || 
                     currentPath.includes('reset-password.html') ||
                     currentPath.endsWith('/');

  if (requireAuth) {
    if (!profileData) {
      // User is not logged in. Redirect to login.html.
      window.location.href = '/login.html';
      return null;
    }
    // Populate user elements if present
    populateUserElements(profileData);
    return profileData;
  } else {
    // Auth page: if logged in, skip to dashboard.html
    if (profileData && isAuthPage) {
      window.location.href = '/dashboard.html';
    }
    return profileData;
  }
}

// Log out user
async function logout() {
  try {
    const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (res.ok) {
      window.location.href = '/login.html';
    } else {
      alert('Failed to log out cleanly.');
    }
  } catch (err) {
    console.error('Logout error:', err);
    window.location.href = '/login.html';
  }
}

// Populate user information in layout elements
function populateUserElements(profileData) {
  const { user } = profileData;
  if (!user) return;

  // Sidebar elements
  const avatarEl = document.getElementById('user-avatar-initials');
  const nameEl = document.getElementById('user-display-name');
  const emailEl = document.getElementById('user-display-email');

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl) nameEl.textContent = user.name;
  if (emailEl) emailEl.textContent = user.email;
}

// Toggle Sidebar for mobile responsive views
function initMobileSidebar() {
  const toggleBtn = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!sidebar.contains(e.target) && e.target !== toggleBtn) {
        sidebar.classList.remove('open');
      }
    });
  }
}

// Auto-run mobile sidebar initialization when loaded
document.addEventListener('DOMContentLoaded', () => {
  initMobileSidebar();
});
