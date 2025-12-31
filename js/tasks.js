// Collaborative To-Do List for event (per tableId) using backend API and Socket.IO
(function() {
const params = new URLSearchParams(window.location.search);
const tableId = params.get('id') || localStorage.getItem('eventId');
const token = window.token || localStorage.getItem('token');
// Use API_BASE from config.js
const API_BASE = window.API_BASE || '';
let isOwner = false;
let tasks = [];

// Helper: get userId from JWT
function getUserId() {
  try { return JSON.parse(atob(token.split('.')[1])).id; } catch { return null; }
}

// Check owner status
async function checkOwner() {
  const res = await fetch(`${API_BASE}/api/tables/${tableId}`, { headers: { Authorization: token } });
  if (!res.ok) return false;
  const table = await res.json();
  const userId = getUserId();
  return Array.isArray(table.owners) && table.owners.includes(userId);
}

// Fetch tasks from backend
async function fetchTasks() {
  const res = await fetch(`${API_BASE}/api/tables/${tableId}/tasks`, { headers: { Authorization: token } });
  if (!res.ok) return [];
  const data = await res.json();
  tasks = Array.isArray(data.tasks) ? data.tasks : [];
  renderTasks();
}

// Render tasks
function renderTasks() {
  const list = document.getElementById('tasksList');
  list.innerHTML = '';
  // Sort by deadline (oldest to newest), then by ObjectId timestamp if equal
  tasks.sort((a, b) => {
    const dateA = new Date(a.deadline);
    const dateB = new Date(b.deadline);
    if (dateA - dateB !== 0) return dateA - dateB;
    // If deadlines are equal, sort by ObjectId timestamp (older first)
    if (a._id && b._id) {
      return a._id.localeCompare(b._id);
    }
    return 0;
  });
  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '');
    li.innerHTML = `
      <input type="checkbox" ${task.completed ? 'checked' : ''} data-id="${task._id}" class="task-check">
      <span class="task-title">${task.title}</span>
      <span class="task-deadline">${task.deadline ? 'Due: ' + task.deadline : ''}</span>
      <span class="task-actions"></span>
    `;
    // Actions
    const actions = li.querySelector('.task-actions');
    if (isOwner) {
      const editBtn = document.createElement('button');
      editBtn.className = 'edit';
      editBtn.title = 'Edit';
      editBtn.innerHTML = '✏️';
      editBtn.onclick = () => editTask(task._id);
      actions.appendChild(editBtn);
      const delBtn = document.createElement('button');
      delBtn.title = 'Delete';
      delBtn.innerHTML = '🗑️';
      delBtn.onclick = () => deleteTask(task._id);
      actions.appendChild(delBtn);
    }
    list.appendChild(li);
  });
}

// Add task via API
async function addTask(title, deadline) {
  const res = await fetch(`${API_BASE}/api/tables/${tableId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ title, deadline })
  });
  if (!res.ok) {
    alert('Failed to add task');
    return;
  }
  // Optimistic: UI will update via Socket.IO event
}

// Edit task via API
async function editTask(id) {
  const task = tasks.find(t => t._id === id);
  if (!task) return;
  const newTitle = prompt('Edit task description:', task.title);
  if (newTitle === null) return;
  const newDeadline = prompt('Edit deadline (YYYY-MM-DD):', task.deadline);
  if (newDeadline === null) return;
  const res = await fetch(`${API_BASE}/api/tables/${tableId}/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ title: newTitle.trim(), deadline: newDeadline })
  });
  if (!res.ok) alert('Failed to edit task');
}

// Delete task via API
async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  const res = await fetch(`${API_BASE}/api/tables/${tableId}/tasks/${id}`, {
    method: 'DELETE',
    headers: { Authorization: token }
  });
  if (!res.ok) alert('Failed to delete task');
}

// Toggle complete via API
async function toggleComplete(id) {
  const task = tasks.find(t => t._id === id);
  if (!task) return;
  const res = await fetch(`${API_BASE}/api/tables/${tableId}/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ completed: !task.completed })
  });
  if (!res.ok) alert('Failed to update task');
}

// Form submit
document.getElementById('addTaskForm').onsubmit = async function(e) {
  e.preventDefault();
  if (!isOwner) return;
  const title = document.getElementById('taskTitle').value.trim();
  const deadline = document.getElementById('taskDeadline').value;
  if (!title || !deadline) return;
  await addTask(title, deadline);
  this.reset();
};

// Checkbox click
document.getElementById('tasksList').onclick = function(e) {
  if (e.target.classList.contains('task-check')) {
    toggleComplete(e.target.getAttribute('data-id'));
  }
};

// Socket.IO setup
function setupSocket() {
  // Use the global socket initialized by socket.js
  if (window.socket) {
    console.log('Socket.IO is available');
    
    window.socket.on('taskAdded', data => {
      console.log('Received taskAdded', data);
      if (data.tableId === tableId) {
        tasks.push(data.task);
        renderTasks();
      }
    });
    
    window.socket.on('taskUpdated', data => {
      console.log('Received taskUpdated', data);
      if (data.tableId === tableId) {
        const idx = tasks.findIndex(t => t._id === data.task._id);
        if (idx !== -1) {
          tasks[idx] = data.task;
          renderTasks();
        }
      }
    });
    
    window.socket.on('taskDeleted', data => {
      console.log('Received taskDeleted', data);
      if (data.tableId === tableId) {
        tasks = tasks.filter(t => t._id !== data.taskId);
        renderTasks();
      }
    });
  } else {
    console.error('Socket.IO is not available! Check if socket.js is loaded correctly.');
  }
}

// Make fetchTasks available globally for event refreshes
window.fetchTasks = fetchTasks;

// Hide add form if not owner
async function setup() {
  isOwner = await checkOwner();
  if (!isOwner) {
    document.getElementById('addTaskForm').style.display = 'none';
  }
  setupSocket();
  await fetchTasks();
}
setup();
})(); 