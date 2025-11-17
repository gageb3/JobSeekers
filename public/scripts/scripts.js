// Show message to user
function showMessage(message, type = 'info') {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = `
                <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                    ${message}
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                </div>
            `;
    setTimeout(() => {
        messagesDiv.innerHTML = '';
    }, 5000);
}

// Utility: format a job's date for display as MM/DD/YYYY
function jobToISOString(job) {
    try {
        if (!job || job.date === undefined || job.date === null) return '';

        // Normalize to a Date instance
        const d = (typeof job.date === 'string' || typeof job.date === 'number')
            ? new Date(job.date)
            : job.date instanceof Date
                ? job.date
                : new Date(job.date);

        if (isNaN(d.getTime())) return '';

        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    } catch (err) {
        return '';
    }
}

// Convert various date inputs (Date, timestamp, or display string) to an <input type="date"> value (YYYY-MM-DD)
function dateToInputValue(dateLike) {
    try {
        if (!dateLike && dateLike !== 0) return '';
        // If it's already in YYYY-MM-DD format, return as-is when valid
        if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;

        // If it's in MM/DD/YYYY (display) format, convert
        if (typeof dateLike === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateLike)) {
            const parts = dateLike.split('/').map(p => p.padStart(2, '0'));
            // parts: [MM, DD, YYYY]
            return `${parts[2]}-${parts[0]}-${parts[1]}`;
        }

        const d = (typeof dateLike === 'string' || typeof dateLike === 'number')
            ? new Date(dateLike)
            : dateLike instanceof Date
                ? dateLike
                : new Date(dateLike);

        if (isNaN(d.getTime())) return '';
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    } catch (err) {
        return '';
    }
}

// Show temporary save indicator
function showSaveIndicator(element, success = true) {
    const indicator = document.createElement('span');
    indicator.className = `save-indicator ms-2 ${success ? 'text-success' : 'text-danger'}`;
    indicator.innerHTML = success ? '<i class="bi bi-check-circle"></i>' : '<i class="bi bi-x-circle"></i>';

    element.appendChild(indicator);
    setTimeout(() => indicator.classList.add('show'), 10);

    setTimeout(() => {
        indicator.classList.remove('show');
        setTimeout(() => element.removeChild(indicator), 300);
    }, 2000);
}

// Helper to return auth headers for protected API calls
function authHeaders(extra = {}) {
    const token = localStorage.getItem('token');
    const h = { ...extra };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
}

// READ - Load jobs from server with search/sort/date range and pagination
async function loadJobs(filters = null, page = 1, pageSize = 10) {
    try {
        const params = new URLSearchParams();
        if (filters) {
            if (filters.q) params.set('q', filters.q);
            if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
            if (filters.dateTo) params.set('dateTo', filters.dateTo);
            if (filters.dateSort) params.set('sort', filters.dateSort);
        }
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));

        const url = '/api/jobs?' + params.toString();
        const response = await fetch(url, { headers: authHeaders() });

        if (response.status === 401 || response.status === 403) {
            // token invalid/expired — redirect to login
            localStorage.removeItem('token');
            window.location = '/';
            return;
        }

        const payload = await response.json();

        // payload is { jobs: [], total: N }
        const jobs = payload && payload.jobs ? payload.jobs : [];
        const total = payload && typeof payload.total === 'number' ? payload.total : (jobs.length || 0);

        // remember current paging
        window.__currentPage = page;
        window.__pageSize = pageSize;
        window.__totalJobs = total;

            renderJobs(jobs || []);
            renderPageSummary(total, page, pageSize);
            renderPagination(total, page, pageSize);
            showMessage(`Loaded ${jobs.length} of ${total} jobs.`, 'info');
    } catch (error) {
        showMessage(`❌ Error loading jobs: ${error.message}`, 'danger');
    }
}

// Render jobs into the jobList container (keeps existing DOM structure expected by other functions)
function renderJobs(jobs) {
    const jobList = document.getElementById('jobList');
    // If no jobs on this page, but there are jobs in other pages (total > 0), show hint
    const total = window.__totalJobs || 0;
    if (!jobs || jobs.length === 0) {
        if (total > 0) {
            // no jobs on this page (page may be beyond last) — suggest jumping to last page
            const lastPage = Math.max(1, Math.ceil(total / (window.__pageSize || 10)));
            jobList.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="bi bi-exclamation-circle fs-1"></i>
                    <p>No results on this page.</p>
                    <p class="small text-muted">There are ${total} matching jobs across ${lastPage} page(s).</p>
                    <button class="btn btn-sm btn-primary" id="goLastPage">Go to last page (${lastPage})</button>
                </div>
            `;
            const btn = document.getElementById('goLastPage');
            if (btn) btn.addEventListener('click', () => {
                const f = getSearchAndFilter();
                loadJobs(f, lastPage, window.__pageSize || 10);
            });
            return;
        }

        jobList.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-earbuds fs-1"></i>
                <p>No jobs found. Add to the database!</p>
            </div>
        `;
        return;
    }

    jobList.innerHTML = jobs.map(job => `
                <div class="card mb-3 job-card" data-job-id="${job._id}">
                    <div class="card-body">
                        <div class="row align-items-center">
                            <div class="col-md-4">
                                <strong>Company:</strong>
                                <div class="editable-field" 
                                     data-field="company" 
                                     data-job-id="${job._id}"
                                     title="Click to edit company">${job.company}</div>
                            </div>
                            <div class="col-md-3">
                                <strong>Position:</strong>
                                <div class="editable-field" 
                                     data-field="position" 
                                     data-job-id="${job._id}"
                                     title="Click to edit position">${job.position}</div>
                            </div>
                            <div class="col-md-3">
                                <strong>Date:</strong>
                                <div class="editable-field" 
                                     data-field="date" 
                                     data-job-id="${job._id}"
                                     title="Click to edit date">${jobToISOString(job)}</div>
                            </div>
                            <div class="col-md-2 text-end">
                                <button class="btn btn-outline-danger btn-sm" 
                                        onclick="deleteJob('${job._id}', '${job.position}')">
                                    <i class="bi bi-trash"></i> Delete
                                </button>
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-12">
                                <label class="form-label mb-1"><strong>Stage:</strong></label>
                                <input type="text" 
                                       class="form-control form-control-sm stage-input" 
                                       data-job-id="${job._id}" 
                                       value="${job.stage || ''}" 
                                       data-initial="${job.stage || ''}" 
                                       placeholder="e.g., Applied, Phone Screen, Offer" />
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');

    // Add click event listeners for inline editing
    addInlineEditListeners();
    // Add listeners for stage inputs (always visible textbox under each job)
    addStageInputListeners();
}


// escape minimal HTML in labels
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// Called by UI Apply button (search bar + date controls)
function applyFilters() {
    const f = getSearchAndFilter();
    window.__activeFilters = f;
    loadJobs(f, 1, window.__pageSize || 10);
}

function resetFilters() {
    // clear UI controls
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    document.getElementById('filterDateSort').value = 'newest';
    window.__activeFilters = null;
    // reload using current search (do not clear search field)
    const f = getSearchAndFilter();
    loadJobs(f, 1, window.__pageSize || 10);
}

// Read search input and date/sort controls into a single filter object
function getSearchAndFilter() {
    const q = (document.getElementById('searchInput') && document.getElementById('searchInput').value) || '';
    return {
        q: q.trim() || null,
        dateFrom: document.getElementById('filterDateFrom').value || null,
        dateTo: document.getElementById('filterDateTo').value || null,
        dateSort: document.getElementById('filterDateSort').value || 'newest'
    };
}

// Pagination rendering and handlers
function renderPagination(total, page, pageSize) {
    const container = document.getElementById('paginationControls');
    if (!container) return;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let html = '';

    // simple previous button
    html += `<nav aria-label="jobs-pagination"><ul class="pagination justify-content-center mb-0">`;
    html += `<li class="page-item ${page <= 1 ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${page-1}">Previous</a></li>`;

    // show up to 7 page links centered around current
    const maxLinks = 7;
    let start = Math.max(1, page - Math.floor(maxLinks/2));
    let end = Math.min(totalPages, start + maxLinks - 1);
    if (end - start < maxLinks - 1) start = Math.max(1, end - maxLinks + 1);

    for (let p = start; p <= end; p++) {
        html += `<li class="page-item ${p === page ? 'active' : ''}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
    }

    html += `<li class="page-item ${page >= totalPages ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${page+1}">Next</a></li>`;
    html += `</ul></nav>`;

    container.innerHTML = html;

    // attach listeners
    container.querySelectorAll('a.page-link').forEach(a => {
        a.addEventListener('click', (ev) => {
            ev.preventDefault();
            const p = parseInt(a.getAttribute('data-page'), 10) || 1;
            if (p < 1) return;
            const f = getSearchAndFilter();
            loadJobs(f, p, window.__pageSize || 10);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // update page summary as well
    renderPageSummary(total, page, pageSize);
}

// Render a small "Showing x–y of N" summary next to the page-size selector
function renderPageSummary(total, page, pageSize) {
    const el = document.getElementById('pageSummary');
    if (!el) return;
    const t = Math.max(0, Number(total) || 0);
    if (t === 0) {
        el.textContent = 'Showing 0 of 0';
        return;
    }
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.max(1, parseInt(pageSize, 10) || 10);
    const start = Math.min(t, (p - 1) * ps + 1);
    const end = Math.min(t, p * ps);
    el.textContent = `Showing ${start}-${end} of ${t}`;
}


// Add listeners for stage input elements (visible textbox under each job card)
function addStageInputListeners() {
    document.querySelectorAll('.stage-input').forEach(input => {
        const jobId = input.getAttribute('data-job-id');

        const saveStage = async () => {
            const newValue = input.value.trim();
            const initial = input.getAttribute('data-initial') || '';

            // If unchanged, do nothing
            if (newValue === initial) return;

            // Call update API
            const success = await updateJobField(jobId, 'stage', newValue);

            if (success) {
                input.setAttribute('data-initial', newValue);
                showSaveIndicator(input.parentElement || input, true);
            } else {
                // revert to previous value on failure
                input.value = initial;
                showSaveIndicator(input.parentElement || input, false);
            }
        };

        input.addEventListener('blur', saveStage);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
        });
    });
}

// Add inline editing functionality
function addInlineEditListeners() {
    document.querySelectorAll('.editable-field').forEach(field => {
        field.addEventListener('click', function () {
            if (this.querySelector('input')) return; // Already editing

            const currentValue = this.textContent;
            const fieldType = this.getAttribute('data-field');
            const jobId = this.getAttribute('data-job-id');

            // Create input element
            const input = document.createElement('input');
            input.type = fieldType === 'date' ? 'date' : 'text';
            // For dates, the displayed format is MM/DD/YYYY but <input type="date"> expects YYYY-MM-DD
            if (fieldType === 'date') {
                input.value = dateToInputValue(currentValue) || '';
            } else {
                input.value = currentValue;
            }
            input.className = 'form-control form-control-sm';


            // Add styling for editing state
            this.classList.add('editing');
            this.innerHTML = '';
            this.appendChild(input);

            // Focus and select the input
            input.focus();
            input.select();

            // Save on Enter or blur
            const saveEdit = async () => {
                const newValue = input.value.trim();

                if (!newValue) {
                    this.textContent = currentValue;
                    this.classList.remove('editing');
                    showMessage('❌ Value cannot be empty', 'warning');
                    return;
                }

                if (newValue === currentValue) {
                    this.textContent = currentValue;
                    this.classList.remove('editing');
                    return;
                }

                // Update in database
                const success = await updateJobField(jobId, fieldType, newValue);

                if (success) {
                    this.textContent = newValue;
                    showSaveIndicator(this, true);
                } else {
                    this.textContent = currentValue;
                    showSaveIndicator(this, false);
                }

                this.classList.remove('editing');
            };

            input.addEventListener('blur', saveEdit);
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    saveEdit();
                } else if (e.key === 'Escape') {
                    this.textContent = currentValue;
                    this.classList.remove('editing');
                }
            });
        });
    });
}

// UPDATE - Update single field
async function updateJobField(jobId, field, value) {
    try {
        const updateData = {};
        updateData[field] = field === 'date' ? new Date(value) : value;

        const response = await fetch(`/api/jobs/${jobId}`, {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(updateData)
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            window.location = '/';
            return false;
        }

        const result = await response.json();

        if (response.ok) {
            showMessage(`✅ ${field.charAt(0).toUpperCase() + field.slice(1)} updated successfully!`, 'success');
            return true;
        } else {
            showMessage(`❌ Error: ${result.error}`, 'danger');
            return false;
        }
    } catch (error) {
        showMessage(`❌ Network error: ${error.message}`, 'danger');
        return false;
    }
}

// DELETE - Delete job
async function deleteJob(id, position) {
    if (!confirm(`Are you sure you want to delete job at position "${position}"?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/jobs/${id}`, {
            method: 'DELETE',
            headers: authHeaders()
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            window.location = '/';
            return;
        }

        const result = await response.json();

        if (response.ok) {
            showMessage(`✅ Job at position "${position}" deleted successfully!`, 'success');

            // Animate removal
            const jobCard = document.querySelector(`[data-job-id="${id}"]`);
            if (jobCard) {
                jobCard.style.opacity = '0';
                jobCard.style.transform = 'translateX(-100%)';
                setTimeout(() => {
                    jobCard.remove();
                }, 300);
            }
        } else {
            showMessage(`❌ Error: ${result.error}`, 'danger');
        }
    } catch (error) {
        showMessage(`❌ Network error: ${error.message}`, 'danger');
    }
}

// Cleanup Database
async function cleanupDatabase() {
    if (!confirm('⚠️ This will DELETE ALL jobs from the database. Are you sure?')) {
        return;
    }

    try {
        showMessage('🧹 Cleaning database...', 'info');
        const response = await fetch('/api/cleanup', {
            method: 'DELETE',
            headers: authHeaders()
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            window.location = '/';
            return;
        }

        const result = await response.json();

        if (response.ok) {
            showMessage(`✅ ${result.message}`, 'success');
            loadJobs();
        } else {
            showMessage(`❌ Error: ${result.error}`, 'danger');
        }
    } catch (error) {
        showMessage(`❌ Network error: ${error.message}`, 'danger');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // default page size for pagination
    window.__pageSize = window.__pageSize || 10;

    // wire page size chooser if present
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
        // set UI to current value
        pageSizeSelect.value = String(window.__pageSize || 10);
        pageSizeSelect.addEventListener('change', () => {
            const v = parseInt(pageSizeSelect.value, 10) || 10;
            window.__pageSize = v;
            // reload starting at page 1 with new page size
            const f = getSearchAndFilter();
            loadJobs(f, 1, window.__pageSize);
        });
    }

// CREATE - Add new job
document.getElementById('addJobForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const job = {
        company: document.getElementById('company').value,
        position: document.getElementById('position').value,
        date: new Date(document.getElementById('date').value)
    };

    try {
        const response = await fetch('/api/jobs', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(job)
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            window.location = '/';
            return;
        }

        const result = await response.json();

        if (response.ok) {
            showMessage(`✅ Job "${job.position}" added successfully!`, 'success');
            document.getElementById('addJobForm').reset();
            loadJobs();
        } else {
            showMessage(`❌ Error: ${result.error}`, 'danger');
        }
    } catch (error) {
        showMessage(`❌ Network error: ${error.message}`, 'danger');
    }
});

// Load jobs when page loads
    // initial load uses selected page size
    loadJobs(getSearchAndFilter(), 1, window.__pageSize || 10);
});