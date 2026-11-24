%global debug_package %{nil}
%global __os_install_post %{nil}
Name:           scripter
Version:        %{scripter_version}
Release:        1
Summary:        Local writing workshop for novels
License:        LicenseRef-Scripter-and-bundled-components
URL:            https://github.com/MartialsArt82/Scripter
BuildArch:      x86_64
Source0:        Scripter-%{version}-Fedora-Nobara-x64.tar.gz
Source1:        de.scripter.Scripter.desktop
Source2:        de.scripter.Scripter.svg
AutoReqProv:    no
Requires:       alsa-lib, at-spi2-core, cairo, cups-libs, dbus-libs, expat, glib2, glibc, gtk3
Requires:       libatomic, libgcc, libstdc++, libX11, libXcomposite, libXdamage, libXext, libXfixes, libXrandr
Requires:       libxcb, libxkbcommon, libxcrypt, mesa-libgbm, nspr, nss, pango, systemd-libs

%description
Scripter is a local writing app with chapter planning, a storyboard, typesetting,
and offline transcription after the optional speech setup.

%prep
%setup -q -n Scripter

%install
mkdir -p %{buildroot}/opt/scripter %{buildroot}%{_bindir}
cp -a . %{buildroot}/opt/scripter/
ln -s /opt/scripter/Scripter %{buildroot}%{_bindir}/scripter
install -Dm644 %{SOURCE1} %{buildroot}%{_datadir}/applications/de.scripter.Scripter.desktop
install -Dm644 %{SOURCE2} %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/de.scripter.Scripter.svg
chmod -R a+rX %{buildroot}/opt/scripter

%files
/opt/scripter
%{_bindir}/scripter
%{_datadir}/applications/de.scripter.Scripter.desktop
%{_datadir}/icons/hicolor/scalable/apps/de.scripter.Scripter.svg
