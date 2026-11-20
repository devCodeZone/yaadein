/**
 * PeoplePage  – everyone the AI found, as round face avatars.
 * PersonPage  – one person: rename, merge, hide, fix wrong faces, see photos.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useLibrary, personName } from '../state/useLibrary';
import { FaceAvatar } from '../components/FaceAvatar';
import { PhotoGrid } from '../components/PhotoGrid';
import { EmptyState } from '../components/EmptyState';
import { useLightbox } from '../components/useLightbox';
import { Icon } from '../components/Icon';
import { plural } from '../utils/dates';

export function PeoplePage() {
  const people = useLibrary((s) => s.people);
  const photoIdsByPerson = useLibrary((s) => s.photoIdsByPerson);
  const faces = useLibrary((s) => s.faces);
  const ai = useLibrary((s) => s.ai);
  const [showHidden, setShowHidden] = useState(false);
  const [showSmall, setShowSmall] = useState(false);

  const list = useMemo(
    () =>
      people
        .map((p) => ({ person: p, count: photoIdsByPerson.get(p.id)?.length || 0 }))
        .filter((x) => x.count > 0 && (showHidden ? x.person.hidden : !x.person.hidden))
        .filter((x) => showSmall || x.count >= 2 || x.person.name)
        // Named people first, then the most photographed.
        .sort((a, b) => Number(Boolean(b.person.name)) - Number(Boolean(a.person.name)) || b.count - a.count),
    [people, photoIdsByPerson, showHidden, showSmall]
  );
  const ungrouped = faces.filter((f) => !f.personId).length;

  if (!faces.length) {
    return (
      <EmptyState
        title="No faces yet"
        text={ai.running ? `Yaadein is looking for faces in your photos (${ai.done.toLocaleString()} / ${ai.total.toLocaleString()} done). People will appear here as they're found.` : 'Once photos are added, faces are found and grouped automatically — right on your computer.'}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">People</h1>
        <div className="page-head__actions">
          <label className="toggle-label">
            <input type="checkbox" checked={showSmall} onChange={(e) => setShowSmall(e.target.checked)} /> Show people with 1 photo
          </label>
          <button className={`chip ${showHidden ? 'is-on' : ''}`} onClick={() => setShowHidden((v) => !v)}>
            <Icon name="eyeoff" size={14} /> Hidden people
          </button>
        </div>
      </div>
      <p className="muted">
        Tap a face to name them — then search for that name anywhere. {ungrouped > 0 && `${plural(ungrouped, 'face')} are waiting for a match.`}
      </p>

      <div className="people-grid">
        {list.map(({ person, count }) => (
          <Link key={person.id} to={`/people/${person.id}`} className="person-card">
            <FaceAvatar faceId={person.coverFaceId} name={person.name} size={112} />
            <strong className={person.name ? '' : 'muted'}>{personName(person)}</strong>
            <small>{plural(count, 'photo')}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PersonPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const person = useLibrary((s) => s.peopleById.get(id));
  const people = useLibrary((s) => s.people);
  const photosById = useLibrary((s) => s.photosById);
  const photoIdsByPerson = useLibrary((s) => s.photoIdsByPerson);
  const faces = useLibrary((s) => s.faces);
  const renamePerson = useLibrary((s) => s.renamePerson);
  const load = useLibrary((s) => s.load);
  const { open, lightbox } = useLightbox();

  const [name, setName] = useState(person?.name || '');
  const [mode, setMode] = useState<'photos' | 'faces' | 'merge'>('photos');
  const [mergeIds, setMergeIds] = useState<string[]>([]);

  const photos = useMemo(
    () => (photoIdsByPerson.get(id) || []).map((pid) => photosById.get(pid)!).filter(Boolean).sort((a, b) => b.takenAt - a.takenAt),
    [id, photoIdsByPerson, photosById]
  );
  const myFaces = useMemo(() => faces.filter((f) => f.personId === id), [faces, id]);
  const others = useMemo(
    () =>
      people
        .filter((p) => p.id !== id && !p.hidden && (photoIdsByPerson.get(p.id)?.length || 0) > 0)
        .sort((a, b) => (photoIdsByPerson.get(b.id)?.length || 0) - (photoIdsByPerson.get(a.id)?.length || 0)),
    [people, id, photoIdsByPerson]
  );

  if (!person) {
    return <EmptyState title="Person not found" text="They may have been merged with someone else." action={<Link className="btn" to="/people">Back to People</Link>} />;
  }

  const saveName = () => {
    if (name.trim() !== person.name) renamePerson(person.id, name.trim());
  };

  return (
    <div className="page">
      <Link to="/people" className="back-link">
        <Icon name="left" size={16} /> People
      </Link>

      <header className="person-hero">
        <FaceAvatar faceId={person.coverFaceId} name={person.name} size={120} ring />
        <div className="person-hero__body">
          <input
            className="name-input"
            value={name}
            placeholder="Add a name"
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <p className="muted">{plural(photos.length, 'photo')}</p>
          {api.desktop && (
            <div className="btn-row">
              <button className={`btn ${mode === 'faces' ? 'btn--primary' : ''}`} onClick={() => setMode(mode === 'faces' ? 'photos' : 'faces')}>
                <Icon name="edit" size={16} /> Fix wrong faces
              </button>
              <button className={`btn ${mode === 'merge' ? 'btn--primary' : ''}`} onClick={() => setMode(mode === 'merge' ? 'photos' : 'merge')}>
                <Icon name="merge" size={16} /> Same person as…
              </button>
              <button
                className="btn"
                onClick={async () => {
                  await api.desktop!.updatePerson(person.id, { hidden: !person.hidden });
                  await load();
                }}
              >
                <Icon name="eyeoff" size={16} /> {person.hidden ? 'Unhide' : 'Hide'}
              </button>
              <button className="btn" onClick={() => navigate('/organize', { state: { photoIds: photos.map((p) => p.id), style: 'people' } })}>
                <Icon name="wand" size={16} /> Copy to a folder
              </button>
            </div>
          )}
        </div>
      </header>

      {mode === 'faces' && (
        <section className="panel">
          <h3>Tap ✕ on any face that is NOT {person.name || 'this person'}</h3>
          <div className="faces-grid">
            {myFaces.map((f) => (
              <div key={f.id} className="face-fix">
                <FaceAvatar faceId={f.id} size={84} />
                <button
                  className="face-fix__x"
                  title="Not this person"
                  onClick={async () => {
                    await api.desktop!.removeFaceFromPerson(f.id);
                    await load();
                  }}
                >
                  <Icon name="x" size={14} />
                </button>
                <button
                  className="face-fix__cover"
                  title="Use as profile picture"
                  onClick={async () => {
                    await api.desktop!.updatePerson(person.id, { coverFaceId: f.id });
                    await load();
                  }}
                >
                  ★
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {mode === 'merge' && (
        <section className="panel">
          <h3>Pick the other groups that are also {person.name || 'this person'}</h3>
          <div className="people-grid people-grid--small">
            {others.map((p) => {
              const on = mergeIds.includes(p.id);
              return (
                <button key={p.id} className={`person-card ${on ? 'is-on' : ''}`} onClick={() => setMergeIds(on ? mergeIds.filter((x) => x !== p.id) : [...mergeIds, p.id])}>
                  <FaceAvatar faceId={p.coverFaceId} name={p.name} size={72} ring={on} />
                  <strong className={p.name ? '' : 'muted'}>{personName(p)}</strong>
                  <small>{photoIdsByPerson.get(p.id)?.length || 0}</small>
                </button>
              );
            })}
          </div>
          <div className="btn-row">
            <button
              className="btn btn--primary"
              disabled={!mergeIds.length}
              onClick={async () => {
                await api.desktop!.mergePeople(mergeIds, person.id);
                setMergeIds([]);
                setMode('photos');
                await load();
              }}
            >
              <Icon name="merge" size={16} /> Merge {mergeIds.length || ''} into {person.name || 'this person'}
            </button>
          </div>
        </section>
      )}

      <PhotoGrid photos={photos} onOpen={open} />
      {lightbox}
    </div>
  );
}
