const destination = new URL('./index.html', location.href);
destination.search = location.search;
destination.hash = location.hash;
location.replace(destination.href);
