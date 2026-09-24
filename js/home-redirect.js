const current = new URL(location.href);
const destination = new URL(current.searchParams.has('liste') && !current.searchParams.has('invite') ? './roster.html' : './planning.html', current);
destination.search = current.search; destination.hash = current.hash;
location.replace(destination.href);
